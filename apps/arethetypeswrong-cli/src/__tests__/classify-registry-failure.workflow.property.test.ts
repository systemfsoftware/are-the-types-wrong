import { it } from '@effect/vitest'
import { Effect, Match, Predicate, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { classifyRegistryFailure, failureOutcome, type RegistryObservation } from '../Failure.js'
import {
  AnalysisFailed,
  type AttwFailure,
  ConfigInvalid,
  type FailureDocument,
  FailureDocumentSchema,
  FailureKindSchema,
  InvalidPackageSpec,
  PackFailed,
  RegistryBadResponse,
  RegistryNotFound,
  RegistryUnreachable,
  TargetNotPackable,
} from '../Failure.schema.js'

const nonSpaceText = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-_/()[]'

const nonSpaceUnit = fc.constantFrom(...nonSpaceText.split(''))
const textUnit = fc.constantFrom(...`${nonSpaceText} `.split(''))

const toolText: fc.Arbitrary<string> = fc
  .tuple(nonSpaceUnit, fc.array(textUnit, { maxLength: 46 }), nonSpaceUnit)
  .map(([head, middle, tail]) => head + middle.join('') + tail)

const rawRegistryCause: fc.Arbitrary<string> = fc
  .string({ unit: fc.constantFrom(...'0123456789abcdef'.split('')), minLength: 8, maxLength: 16 })
  .map((hex) => `<<raw-package-cause:${hex}>>`)

const httpStatus: fc.Arbitrary<number> = fc.oneof(fc.constant(404), fc.integer({ min: 0, max: 599 }))

const registryObservation: fc.Arbitrary<RegistryObservation> = fc.oneof(
  httpStatus.map((status): RegistryObservation => ({ kind: 'http-status', status })),
  fc.constant<RegistryObservation>({ kind: 'no-response' }),
  fc.constant<RegistryObservation>({ kind: 'unexpected-shape' }),
)

type RawRegistryObservation = RegistryObservation & { readonly cause: string }

const rawRegistryObservation: fc.Arbitrary<RawRegistryObservation> = fc.oneof(
  fc
    .tuple(httpStatus, rawRegistryCause)
    .map(([status, cause]): RawRegistryObservation => ({ kind: 'http-status', status, cause })),
  rawRegistryCause.map((cause): RawRegistryObservation => ({ kind: 'no-response', cause })),
  rawRegistryCause.map((cause): RawRegistryObservation => ({ kind: 'unexpected-shape', cause })),
)

type RegistryCauseClass = 'not-found' | 'bad-status' | 'no-response' | 'unexpected-shape'

const causeClass = (observation: RegistryObservation): RegistryCauseClass =>
  Match.value(observation).pipe(
    Match.when({ kind: 'no-response' }, (): RegistryCauseClass => 'no-response'),
    Match.when({ kind: 'unexpected-shape' }, (): RegistryCauseClass => 'unexpected-shape'),
    Match.when({ kind: 'http-status', status: 404 }, (): RegistryCauseClass => 'not-found'),
    Match.when({ kind: 'http-status' }, (): RegistryCauseClass => 'bad-status'),
    Match.exhaustive,
  )

const variantByCauseClass: Readonly<Record<RegistryCauseClass, AttwFailure['_tag']>> = {
  'not-found': 'RegistryNotFound',
  'bad-status': 'RegistryBadResponse',
  'no-response': 'RegistryUnreachable',
  'unexpected-shape': 'RegistryBadResponse',
}

type FailureFields = {
  readonly tag: AttwFailure['_tag']
  readonly message: string
  readonly recovery: string
}

const failureFields: fc.Arbitrary<FailureFields> = fc.record({
  tag: Schema.toArbitrary(FailureKindSchema)(fc),
  message: toolText,
  recovery: toolText,
})

type FailureFactory = (props: { readonly message: string; readonly recovery: string }) => AttwFailure

const failureConstructors: Readonly<Record<AttwFailure['_tag'], FailureFactory>> = {
  InvalidPackageSpec: (props) => new InvalidPackageSpec(props),
  ConfigInvalid: (props) => new ConfigInvalid(props),
  RegistryNotFound: (props) => new RegistryNotFound(props),
  RegistryUnreachable: (props) => new RegistryUnreachable(props),
  RegistryBadResponse: (props) => new RegistryBadResponse(props),
  PackFailed: (props) => new PackFailed(props),
  TargetNotPackable: (props) => new TargetNotPackable(props),
  AnalysisFailed: (props) => new AnalysisFailed(props),
}

const failureFromFields = (fields: FailureFields): AttwFailure =>
  failureConstructors[fields.tag]({ message: fields.message, recovery: fields.recovery })

const parseJson = (text: string): unknown => JSON.parse(text)

const decodeFailureDocument = (document: string): Result.Result<FailureDocument, unknown> =>
  Result.flatMap(
    Result.try(() => parseJson(document)),
    (parsed) =>
      Schema.decodeUnknownResult(FailureDocumentSchema, { onExcessProperty: 'error', propertyOrder: 'original' })(
        parsed,
      ),
  )

it.effect.prop('∀obs_FailureClassify_∈declaredVariant', [registryObservation], ([observation]) => {
  const failure = classifyRegistryFailure(observation)
  return Effect.succeed(
    Predicate.isTagged(failure, variantByCauseClass[causeClass(observation)]) &&
      failure.message.length > 0 &&
      failure.recovery.length > 0,
  )
})

it.effect.prop('∀failure_FailureDocument_={status,kind,message,recovery}', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  const { document } = failureOutcome(failure, { isTty: false })
  const decoded = decodeFailureDocument(document)
  return Effect.succeed(
    Result.isSuccess(decoded) &&
      decoded.success.kind === fields.tag &&
      decoded.success.message === fields.message &&
      decoded.success.recovery === fields.recovery &&
      decoded.success.recovery.length > 0 &&
      JSON.stringify(decoded.success) === document.trimEnd(),
  )
})

it.effect.prop('∀failure_FailureTtyDocument_=1line∋recovery', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  const { document } = failureOutcome(failure, { isTty: true })
  const body = document.trimEnd()
  return Effect.succeed(
    document.endsWith('\n') &&
      !body.includes('\n') &&
      body.includes(fields.message) &&
      body.includes(fields.recovery),
  )
})

it.effect.prop('∀cause_FailureRender_¬cause', [rawRegistryObservation], ([observation]) => {
  const failure = classifyRegistryFailure(observation)
  const cause = observation.cause
  return Effect.succeed(
    !failure.message.includes(cause) &&
      !failure.recovery.includes(cause) &&
      !failureOutcome(failure, { isTty: false }).document.includes(cause) &&
      !failureOutcome(failure, { isTty: true }).document.includes(cause),
  )
})

it.effect.prop('∀failure_FailureExit_=1', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  return Effect.succeed(
    failureOutcome(failure, { isTty: false }).exitCode === 1 &&
      failureOutcome(failure, { isTty: true }).exitCode === 1,
  )
})
