import {
  CheckPackage,
  CheckPackageLive,
  type CheckResult,
  PackageStore,
  PackageStoreStub,
  parsePackageSpec,
  type ResolutionKind,
} from '@systemfsoftware/arethetypeswrong'
import { Effect, Layer, Option, Predicate, Result, Schema as S } from 'effect'
import * as Cause from 'effect/Cause'
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

import {
  classifyRegistryFailure,
  ClassifyRegistryFailureCommand,
  RegistryNoResponseObserved,
  RegistryStatusObserved,
  RegistryUnreadableShapeObserved,
} from './classify-registry-failure.workflow.js'
import { decideEnvelope } from './envelope-document.js'
import {
  AnalysisFailed,
  type AttwFailure,
  ConfigInvalid,
  PackFailed,
  RegistryBadResponse,
  TargetNotPackable,
} from './Failure.schema.js'
import { CliFilesystem as Filesystem } from './FilesystemAdapter.js'
import { renderHints } from './hint-shaping.js'
import { decodeIncludeMask } from './Mask.js'
import { DecideHintsCommand, offerRecoveryHints, RunHintsRequest } from './offer-recovery-hints.workflow.js'
import { PackRunner } from './PackRunnerAdapter.js'
import { applyProfile, type CliProfileName } from './Profiles.js'
import { ApplyProfileCommand } from './Profiles.schema.js'
import { RegistryDocument } from './Registry.schema.js'
import { buildManifestUrl, decodePayloadSize, decodeRegistryUrl, type PayloadKind } from './RegistryUrl.js'
import { renderAnalysisForMode } from './Render.js'
import { resolveAcquisitionSource, ResolveAcquisitionSourceCommand } from './resolve-acquisition-source.workflow.js'
import { DecideRenderModeCommand, type RequestedFormat, selectRenderMode } from './select-render-mode.workflow.js'
import { Terminal } from './TerminalAdapter.js'

export interface CliRequest {
  readonly fileOrDirectory: string
  readonly pack?: boolean
  readonly fromNpm?: boolean
  readonly definitelyTyped?: string | boolean
  readonly format?: RequestedFormat
  readonly quiet?: boolean
  readonly entrypoints?: readonly string[]
  readonly includeEntrypoints?: readonly string[]
  readonly excludeEntrypoints?: readonly string[]
  readonly entrypointsLegacy?: boolean
  readonly include?: readonly string[]
  readonly ignoreRules?: readonly string[]
  readonly ignoreResolutions?: readonly ResolutionKind[]
  readonly profile?: CliProfileName
  readonly summary?: boolean
  readonly emoji?: boolean
  readonly color?: boolean
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

const fetchRegistryResponse = (url: string): Effect.Effect<Response, AttwFailure> =>
  Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),
    catch: () =>
      Result.getOrThrow(
        classifyRegistryFailure(new ClassifyRegistryFailureCommand({ observation: new RegistryNoResponseObserved() })),
      ),
  }).pipe(
    Effect.timeout('60 seconds'),
    Effect.catchIf(
      (error): error is Cause.TimeoutError => Cause.isTimeoutError(error),
      () =>
        Effect.fail(
          Result.getOrThrow(
            classifyRegistryFailure(
              new ClassifyRegistryFailureCommand({ observation: new RegistryNoResponseObserved() }),
            ),
          ),
        ),
    ),
  )

const readBoundedBody = (response: Response, kind: PayloadKind): Effect.Effect<Uint8Array, AttwFailure> =>
  Effect.gen(function*() {
    const declared = Number(response.headers.get('content-length') ?? 'NaN')
    if (Number.isFinite(declared)) yield* boundPayload(kind, declared)
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: () =>
        Result.getOrThrow(
          classifyRegistryFailure(
            new ClassifyRegistryFailureCommand({ observation: new RegistryNoResponseObserved() }),
          ),
        ),
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
      const bytes = yield* fs.readBytes(tarballPath).pipe(
        Effect.mapError(() => packFailed()),
        Effect.ensuring(fs.deleteFile(tarballPath).pipe(Effect.orElseSucceed(() => undefined))),
      )
      return {
        bytes,
        ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${tarballPath}` },
      }
    }
    const source = yield* Effect.fromResult(
      resolveAcquisitionSource(
        new ResolveAcquisitionSourceCommand({
          target,
          fromNpm: request.fromNpm === true,
          parsed: Result.match(parsePackageSpec(target), {
            onFailure: () => Option.none(),
            onSuccess: (spec) => Option.some(spec),
          }),
        }),
      ),
    )
    if (Predicate.isTagged(source, 'ExistingTarball')) {
      const bytes = yield* fs.readBytes(target).pipe(Effect.mapError(() =>
        new TargetNotPackable({
          message: 'The target is not a package tarball this tool can read.',
          recovery:
            'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.',
        })
      ))
      return {
        bytes,
        ref: { packageName: target, packageVersion: 'local', tarballUrl: `file://${target}` },
      }
    }
    const spec = source.spec
    const registryBase = yield* registryBaseFrom(request.registry)
    const manifestResponse = yield* fetchRegistryResponse(buildManifestUrl(registryBase, spec))
    if (!manifestResponse.ok) {
      return yield* Effect.fail(
        Result.getOrThrow(
          classifyRegistryFailure(
            new ClassifyRegistryFailureCommand({
              observation: new RegistryStatusObserved({ status: manifestResponse.status }),
            }),
          ),
        ),
      )
    }
    const manifestBytes = yield* readBoundedBody(manifestResponse, 'registry-document')
    const registry = yield* S.decodeUnknownEffect(S.fromJsonString(RegistryDocument))(
      new TextDecoder().decode(manifestBytes),
    ).pipe(
      Effect.mapError(() =>
        Result.getOrThrow(
          classifyRegistryFailure(
            new ClassifyRegistryFailureCommand({ observation: new RegistryUnreadableShapeObserved() }),
          ),
        )
      ),
    )
    const tarballUrl = yield* tarballUrlFrom(registry.dist.tarball)
    const tarballResponse = yield* Effect.tryPromise({
      try: async () => await fetch(tarballUrl),
      catch: () =>
        Result.getOrThrow(
          classifyRegistryFailure(
            new ClassifyRegistryFailureCommand({ observation: new RegistryNoResponseObserved() }),
          ),
        ),
    })
    if (!tarballResponse.ok) {
      return yield* Effect.fail(
        Result.getOrThrow(
          classifyRegistryFailure(
            new ClassifyRegistryFailureCommand({
              observation: new RegistryStatusObserved({ status: tarballResponse.status }),
            }),
          ),
        ),
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

    const include = request.include ?? []
    const mask = yield* Effect.fromResult(decodeIncludeMask(include))

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
    const mode = Result.getOrThrow(
      selectRenderMode(
        new DecideRenderModeCommand({
          isTty: terminal.isTty,
          terminalWidth: terminal.width,
          requestedFormat: request.format ?? 'auto',
          quiet: request.quiet ?? false,
        }),
      ),
    ).mode
    const envelope = decideEnvelope({
      result: prepared.result,
      ignoreRules: prepared.ignoreRules,
      ignoreResolutions: prepared.ignoreResolutions,
      mask,
    })
    const output = renderAnalysisForMode(prepared.result, mode, {
      color: request.color ?? true,
      summary: request.summary ?? true,
      ignoreRules: prepared.ignoreRules,
      useEmoji: request.emoji ?? true,
    }, envelope.document)
    if (output !== '') yield* terminal.stdout.write(output)
    const hintDecision = Result.getOrThrow(
      offerRecoveryHints(
        new DecideHintsCommand({
          request: new RunHintsRequest({
            document: envelope.document,
            mode,
            isTty: terminal.isTty,
            include,
            mask,
          }),
        }),
      ),
    )
    if (Predicate.isTagged(hintDecision, 'HintsOffered')) {
      const hints = renderHints(hintDecision.hints)
      if (hints !== '') yield* terminal.stderr.write(hints)
    }
    return envelope.exitCode
  })

export const _attwCliExecutorUsed = {
  applyProfile,
  renderAnalysisForMode,
  prepareAnalysis,
  CheckPackage,
  PackageStore,
}
