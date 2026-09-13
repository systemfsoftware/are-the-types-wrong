import {
  CheckPackage,
  CheckPackageLive,
  type CheckResult,
  PackageStore,
  PackageStoreStub,
  type ParsedPackageSpec,
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
import { CliFilesystem as Filesystem, type FilesystemService } from './FilesystemAdapter.js'
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
import { Terminal, type TerminalWriteSink } from './TerminalAdapter.js'

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

const defaulted = <A>(value: A | undefined, fallback: A): A => value ?? fallback

const profileCommandFor = (
  profileName: CliProfileName,
  ignoreResolutions: readonly ResolutionKind[] | undefined,
): ApplyProfileCommand => {
  if (ignoreResolutions === undefined) return new ApplyProfileCommand({ profileName })
  return new ApplyProfileCommand({ profileName, ignoreResolutions })
}

const withProfileApplied = (request: CliRequest): CliRequest => {
  if (request.profile === undefined) return request
  const profileCommand = profileCommandFor(request.profile, request.ignoreResolutions)
  return { ...request, ignoreResolutions: applyProfile(profileCommand).ignoreResolutions }
}

export const prepareAnalysis = (
  request: CliRequest,
  result: CheckResult,
): {
  result: CheckResult
  ignoreRules: readonly string[]
  ignoreResolutions: readonly ResolutionKind[]
} => {
  const profileApplied = withProfileApplied(request)
  return {
    result,
    ignoreRules: defaulted(profileApplied.ignoreRules, []),
    ignoreResolutions: defaulted(profileApplied.ignoreResolutions, []),
  }
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

const classifiedFailure = (
  observation: RegistryStatusObserved | RegistryNoResponseObserved | RegistryUnreadableShapeObserved,
): AttwFailure => Result.getOrThrow(classifyRegistryFailure(new ClassifyRegistryFailureCommand({ observation })))

const noResponseFailure = (): AttwFailure => classifiedFailure(new RegistryNoResponseObserved())

const fetchRegistryResponse = (url: string): Effect.Effect<Response, AttwFailure> =>
  Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),
    catch: () => noResponseFailure(),
  }).pipe(
    Effect.timeout('60 seconds'),
    Effect.catchIf(
      (error): error is Cause.TimeoutError => Cause.isTimeoutError(error),
      () => Effect.fail(noResponseFailure()),
    ),
  )

const requireOkResponse = (response: Response): Effect.Effect<void, AttwFailure> => {
  if (response.ok) return Effect.void
  return Effect.fail(classifiedFailure(new RegistryStatusObserved({ status: response.status })))
}

const declaredByteLength = (response: Response): number => Number(response.headers.get('content-length') ?? 'NaN')

const boundDeclaredLength = (response: Response, kind: PayloadKind): Effect.Effect<void, AttwFailure> => {
  const declared = declaredByteLength(response)
  if (Number.isFinite(declared)) return boundPayload(kind, declared)
  return Effect.void
}

const readBoundedBody = (response: Response, kind: PayloadKind): Effect.Effect<Uint8Array, AttwFailure> =>
  Effect.gen(function*() {
    yield* boundDeclaredLength(response, kind)
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: () => noResponseFailure(),
    })
    yield* boundPayload(kind, bytes.byteLength)
    return bytes
  })

interface TarballAcquisition {
  readonly bytes: Uint8Array
  readonly ref: { readonly packageName: string; readonly packageVersion: string; readonly tarballUrl: string }
}

const acquirePackedTarball = (
  request: CliRequest,
  fs: FilesystemService,
): Effect.Effect<TarballAcquisition, AttwFailure, PackRunner | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const packRunner = yield* PackRunner
    const target = request.fileOrDirectory
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
  })

const acquireExistingTarball = (
  target: string,
  fs: FilesystemService,
): Effect.Effect<TarballAcquisition, AttwFailure> =>
  Effect.gen(function*() {
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
  })

const acquireRegistryTarball = (
  registry: string,
  spec: ParsedPackageSpec,
): Effect.Effect<TarballAcquisition, AttwFailure> =>
  Effect.gen(function*() {
    const registryBase = yield* registryBaseFrom(registry)
    const manifestResponse = yield* fetchRegistryResponse(buildManifestUrl(registryBase, spec))
    yield* requireOkResponse(manifestResponse)
    const manifestBytes = yield* readBoundedBody(manifestResponse, 'registry-document')
    const registryDocument = yield* S.decodeUnknownEffect(S.fromJsonString(RegistryDocument))(
      new TextDecoder().decode(manifestBytes),
    ).pipe(
      Effect.mapError(() => classifiedFailure(new RegistryUnreadableShapeObserved())),
    )
    const tarballUrl = yield* tarballUrlFrom(registryDocument.dist.tarball)
    const tarballResponse = yield* Effect.tryPromise({
      try: async () => await fetch(tarballUrl),
      catch: () => noResponseFailure(),
    })
    yield* requireOkResponse(tarballResponse)
    const bytes = yield* readBoundedBody(tarballResponse, 'tarball')
    return {
      bytes,
      ref: { packageName: registryDocument.name, packageVersion: registryDocument.version, tarballUrl },
    }
  })

const acquireUnpackedTarball = (
  request: CliRequest,
  fs: FilesystemService,
): Effect.Effect<TarballAcquisition, AttwFailure> =>
  Effect.gen(function*() {
    const target = request.fileOrDirectory
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
    if (Predicate.isTagged(source, 'ExistingTarball')) return yield* acquireExistingTarball(target, fs)
    return yield* acquireRegistryTarball(request.registry, source.spec)
  })

const acquireTarball = (
  request: CliRequest,
): Effect.Effect<TarballAcquisition, AttwFailure, Filesystem | PackRunner | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const fs = yield* Filesystem
    if (request.pack === true) return yield* acquirePackedTarball(request, fs)
    return yield* acquireUnpackedTarball(request, fs)
  })

const copiedUnlessEmpty = (values: readonly string[]): string[] | undefined => {
  if (values.length === 0) return undefined
  return [...values]
}

const copyIfNonEmpty = (values: readonly string[] | undefined): string[] | undefined => {
  if (values === undefined) return undefined
  return copiedUnlessEmpty(values)
}

const writeUnlessEmpty = (sink: TerminalWriteSink, text: string): Effect.Effect<void, never> => {
  if (text === '') return Effect.void
  return sink.write(text)
}

export const runAttw = (
  request: CliRequest,
): Effect.Effect<number, AttwFailure, Terminal | Filesystem | PackRunner | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal

    const include = defaulted(request.include, [])
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
          requestedFormat: defaulted(request.format, 'auto'),
          quiet: defaulted(request.quiet, false),
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
      color: defaulted(request.color, true),
      summary: defaulted(request.summary, true),
      ignoreRules: prepared.ignoreRules,
      useEmoji: defaulted(request.emoji, true),
    }, envelope.document)
    yield* writeUnlessEmpty(terminal.stdout, output)
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
      yield* writeUnlessEmpty(terminal.stderr, renderHints(hintDecision.hints))
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
