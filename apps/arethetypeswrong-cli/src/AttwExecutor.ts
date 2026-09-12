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
import { AnalysisFailed, type AttwFailure, PackFailed, TargetNotPackable } from './Failure.schema.js'
import { CliFilesystem as Filesystem } from './FilesystemAdapter.js'
import { computeExitCode } from './GetExitCode.js'
import { ComputeExitCodeCommand } from './GetExitCode.schema.js'
import { PackRunner } from './PackRunnerAdapter.js'
import { applyProfile, type CliProfileName } from './Profiles.js'
import { ApplyProfileCommand } from './Profiles.schema.js'
import { RegistryDocument } from './Registry.schema.js'
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

const targetUnreadable = (): TargetNotPackable =>
  new TargetNotPackable({
    message: 'The target could not be read as a package tarball or directory.',
    recovery: 'Pass an existing directory with --pack, an existing .tgz file, or a package name with --from-npm.',
  })

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
    if (target.endsWith('.tgz') || target.endsWith('.tar.gz')) {
      const bytes = yield* fs.readBytes(target).pipe(Effect.mapError(() => targetUnreadable()))
      return {
        bytes,
        ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${target}` },
      }
    }
    let npmTarget: string
    if (request.fromNpm === true) {
      npmTarget = target
    } else if (/^[a-z@]/.test(target) && !target.includes('/')) {
      npmTarget = target
    } else {
      npmTarget = `file:${target}`
    }
    const isNpmSpec = !npmTarget.startsWith('file:')
    if (isNpmSpec) {
      const [name = npmTarget, version = 'latest'] = npmTarget.split('@').filter(Boolean)
      const manifestUrl = `${request.registry.replace(/\/$/, '')}/${encodeURIComponent(name)}/${version}`
      const manifestResponse = yield* Effect.tryPromise({
        try: async () => await fetch(manifestUrl),
        catch: () => classifyRegistryFailure({ kind: 'no-response' }),
      })
      if (!manifestResponse.ok) {
        return yield* Effect.fail(
          classifyRegistryFailure({ kind: 'http-status', status: manifestResponse.status }),
        )
      }
      const manifestBody = yield* Effect.tryPromise({
        try: async (): Promise<unknown> => await manifestResponse.json(),
        catch: () => classifyRegistryFailure({ kind: 'unexpected-shape' }),
      })
      const registry = yield* S.decodeUnknownEffect(RegistryDocument)(manifestBody).pipe(
        Effect.mapError(() => classifyRegistryFailure({ kind: 'unexpected-shape' })),
      )
      const tarballResponse = yield* Effect.tryPromise({
        try: async () => await fetch(registry.dist.tarball),
        catch: () => classifyRegistryFailure({ kind: 'no-response' }),
      })
      if (!tarballResponse.ok) {
        return yield* Effect.fail(
          classifyRegistryFailure({ kind: 'http-status', status: tarballResponse.status }),
        )
      }
      const tarballBytes = yield* Effect.tryPromise({
        try: async () => new Uint8Array(await tarballResponse.arrayBuffer()),
        catch: () => classifyRegistryFailure({ kind: 'unexpected-shape' }),
      })
      return {
        bytes: tarballBytes,
        ref: { packageName: registry.name, packageVersion: registry.version, tarballUrl: registry.dist.tarball },
      }
    }
    const bytes = yield* fs.readBytes(target).pipe(Effect.mapError(() => targetUnreadable()))
    return {
      bytes,
      ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${target}` },
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
