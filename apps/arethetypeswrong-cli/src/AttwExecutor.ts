import {
  CheckPackage,
  CheckPackageLive,
  type CheckResult,
  PackageStore,
  PackageStoreStub,
  type ResolutionKind,
} from '@systemfsoftware/arethetypeswrong'
import { Effect, Layer, Schema as S } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

import { classifyRegistryFailure } from './Failure.js'
import { AnalysisFailed, type AttwFailure, ConfigInvalid, PackFailed, RegistryBadResponse } from './Failure.schema.js'
import { CliFilesystem as Filesystem } from './FilesystemAdapter.js'
import { computeExitCode } from './GetExitCode.js'
import { ComputeExitCodeCommand } from './GetExitCode.schema.js'
import { buildManifestUrl, decodePackageSpec, decodeTargetShape, targetNotPackable } from './PackageSpec.js'
import { PackRunner } from './PackRunnerAdapter.js'
import { applyProfile, type CliProfileName } from './Profiles.js'
import { ApplyProfileCommand } from './Profiles.schema.js'
import { RegistryDocument } from './Registry.schema.js'
import { decodePayloadSize, decodeRegistryUrl, type PayloadKind } from './RegistryUrl.js'
import { renderAnalysis } from './Render.js'
import { Terminal } from './TerminalAdapter.js'

export type CliFormat = 'auto' | 'table' | 'table-flipped' | 'ascii' | 'json'

export interface CliRequest {
  readonly fileOrDirectory: string
  readonly pack?: boolean
  readonly fromNpm?: boolean
  readonly definitelyTyped?: string | boolean
  readonly format?: CliFormat
  readonly quiet?: boolean
  readonly entrypoints?: readonly string[]
  readonly includeEntrypoints?: readonly string[]
  readonly excludeEntrypoints?: readonly string[]
  readonly entrypointsLegacy?: boolean
  readonly ignoreRules?: readonly string[]
  readonly ignoreResolutions?: readonly ResolutionKind[]
  readonly profile?: CliProfileName
  readonly summary?: boolean
  readonly emoji?: boolean
  readonly color?: boolean
  readonly configPath?: string
  readonly moduleKinds?: readonly string[]
  readonly registry: string
}

export const prepareAnalysis = (
  request: CliRequest,
  result: CheckResult,
): {
  result: CheckResult
  ignoreRules: readonly string[]
  ignoreResolutions: readonly ResolutionKind[]
} => {
  let profileApplied: CliRequest = request
  if (request.profile !== undefined) {
    const profileName = request.profile
    const ignoreResolutions = request.ignoreResolutions
    let profileCommand: ApplyProfileCommand
    if (ignoreResolutions === undefined) {
      profileCommand = new ApplyProfileCommand({ profileName })
    } else {
      profileCommand = new ApplyProfileCommand({ profileName, ignoreResolutions })
    }
    const profileDecision = applyProfile(profileCommand)
    profileApplied = { ...request, ignoreResolutions: profileDecision.ignoreResolutions }
  }
  const ignoreRules = profileApplied.ignoreRules ?? []
  const ignoreResolutions = profileApplied.ignoreResolutions ?? []
  return { result, ignoreRules, ignoreResolutions }
}

const packFailed = (): PackFailed =>
  new PackFailed({
    message: '`npm pack` did not produce a readable tarball in the target directory.',
    recovery:
      'Run `npm pack` in the target directory to see the failure, fix it, then rerun the same command with --pack.',
  })

const analysisFailed = (): AnalysisFailed =>
  new AnalysisFailed({
    message: 'The analysis failed before it produced a result.',
    recovery: 'Rerun the same command with --pack on the package directory to rule out a truncated tarball.',
  })

const registryBaseFrom = (registry: string): Effect.Effect<string, AttwFailure> =>
  Effect.mapError(Effect.fromResult(decodeRegistryUrl(registry)), (found) => new ConfigInvalid(found))

const tarballUrlFrom = (tarballUrl: string): Effect.Effect<string, AttwFailure> =>
  Effect.mapError(Effect.fromResult(decodeRegistryUrl(tarballUrl)), (found) => new RegistryBadResponse(found))

const boundPayload = (kind: PayloadKind, byteLength: number): Effect.Effect<void, AttwFailure> =>
  Effect.mapError(Effect.fromResult(decodePayloadSize(kind, byteLength)), (found) => new RegistryBadResponse(found))

const readBoundedBody = (response: Response, kind: PayloadKind): Effect.Effect<Uint8Array, AttwFailure> =>
  Effect.gen(function*() {
    const declared = Number(response.headers.get('content-length') ?? 'NaN')
    if (Number.isFinite(declared)) yield* boundPayload(kind, declared)
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: () => classifyRegistryFailure({ kind: 'unexpected-shape' }),
    })
    yield* boundPayload(kind, bytes.byteLength)
    return bytes
  })

const acquireTarball = (
  request: CliRequest,
): Effect.Effect<
  { bytes: Uint8Array; ref: { packageName: string; packageVersion: string; tarballUrl: string } },
  AttwFailure,
  Filesystem | PackRunner | ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* Filesystem
    const target = request.fileOrDirectory
    if (request.pack === true) {
      const packRunner = yield* PackRunner
      const packed = yield* packRunner.pack(target).pipe(Effect.mapError(() => packFailed()))
      const tarballPath = fs.join(target, packed.tarballPath)
      const bytes = yield* fs.readBytes(tarballPath).pipe(Effect.mapError(() => packFailed()))
      yield* fs.deleteFile(tarballPath)
      return {
        bytes,
        ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${tarballPath}` },
      }
    }
    const shape = yield* Effect.fromResult(
      decodeTargetShape(target, { fromNpm: request.fromNpm === true }),
    )
    if (shape === 'tarball') {
      const bytes = yield* fs.readBytes(target).pipe(Effect.mapError(targetNotPackable))
      return {
        bytes,
        ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${target}` },
      }
    }
    const spec = yield* Effect.fromResult(decodePackageSpec(target))
    const registryBase = yield* registryBaseFrom(request.registry)
    const manifestResponse = yield* Effect.tryPromise({
      try: async () => await fetch(buildManifestUrl(registryBase, spec)),
      catch: () => classifyRegistryFailure({ kind: 'no-response' }),
    })
    if (!manifestResponse.ok) {
      return yield* Effect.fail(
        classifyRegistryFailure({ kind: 'http-status', status: manifestResponse.status }),
      )
    }
    const manifestBytes = yield* readBoundedBody(manifestResponse, 'registry-document')
    const registry = yield* S.decodeUnknownEffect(S.fromJsonString(RegistryDocument))(
      new TextDecoder().decode(manifestBytes),
    ).pipe(
      Effect.mapError(() => classifyRegistryFailure({ kind: 'unexpected-shape' })),
    )
    const tarballUrl = yield* tarballUrlFrom(registry.dist.tarball)
    const tarballResponse = yield* Effect.tryPromise({
      try: async () => await fetch(tarballUrl),
      catch: () => classifyRegistryFailure({ kind: 'no-response' }),
    })
    if (!tarballResponse.ok) {
      return yield* Effect.fail(
        classifyRegistryFailure({ kind: 'http-status', status: tarballResponse.status }),
      )
    }
    const tarballBytes = yield* readBoundedBody(tarballResponse, 'tarball')
    return {
      bytes: tarballBytes,
      ref: { packageName: registry.name, packageVersion: registry.version, tarballUrl },
    }
  })

const copyIfNonEmpty = (values: readonly string[] | undefined): string[] | undefined => {
  if (values === undefined || values.length === 0) return undefined
  return [...values]
}

export const runAttw = (
  request: CliRequest,
): Effect.Effect<number, AttwFailure, Terminal | Filesystem | PackRunner | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal

    const { bytes, ref } = yield* acquireTarball(request)
    const storeLayer = PackageStoreStub(ref, bytes)
    const checkPackageLayer = CheckPackageLive.pipe(Layer.provide(storeLayer))

    const checkEffect: Effect.Effect<CheckResult, AnalysisFailed, never> = Effect.gen(function*() {
      const checkPackage = yield* CheckPackage
      return yield* checkPackage.execute(request.fileOrDirectory, {
        entrypoints: copyIfNonEmpty(request.entrypoints),
        includeEntrypoints: copyIfNonEmpty(request.includeEntrypoints),
        excludeEntrypoints: copyIfNonEmpty(request.excludeEntrypoints),
        entrypointsLegacy: request.entrypointsLegacy,
      })
    }).pipe(
      Effect.provide(Layer.mergeAll(checkPackageLayer, storeLayer)),
      Effect.mapError(() => analysisFailed()),
      Effect.catchDefect(() => Effect.fail(analysisFailed())),
    )
    const result = yield* checkEffect
    const prepared = prepareAnalysis(request, result)
    const exitDecision = computeExitCode(
      new ComputeExitCodeCommand({
        result: prepared.result,
        ignoreRules: [...prepared.ignoreRules],
        ignoreResolutions: [...prepared.ignoreResolutions],
      }),
    )
    if (request.quiet !== true) {
      const output = renderAnalysis(prepared.result, {
        format: request.format ?? 'auto',
        color: request.color ?? true,
        summary: request.summary ?? true,
        ignoreRules: prepared.ignoreRules,
        useEmoji: request.emoji ?? true,
        quiet: request.quiet ?? false,
        terminalWidth: 120,
        isTTY: true,
      })
      yield* terminal.stdout.write(output)
    }
    return exitDecision.exitCode
  })

export const _attwCliExecutorUsed = {
  applyProfile,
  computeExitCode,
  renderAnalysis,
  prepareAnalysis,
  CheckPackage,
  PackageStore,
}
