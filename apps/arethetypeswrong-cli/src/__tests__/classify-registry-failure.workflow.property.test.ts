import { it } from '@effect/vitest'
import { Match, Option, Predicate, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  classifyRegistryFailure,
  ClassifyRegistryFailureCommand,
  RegistryNoResponseObserved,
  type RegistryObservation,
  RegistryStatusObserved,
  RegistryUnreadableShapeObserved,
} from '../classify-registry-failure.workflow.js'
import { failureOutcome } from '../failure-shaping.js'
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

const httpStatus: fc.Arbitrary<number> = fc.oneof(
  fc.constant(404),
  fc.integer({ min: 0, max: 599 }),
  fc.constantFrom(198, 199, 200, 201, 299, 300, 301),
)

const registryObservation: fc.Arbitrary<RegistryObservation> = fc.oneof(
  httpStatus.map((status) => new RegistryStatusObserved({ status })),
  fc.constant(new RegistryNoResponseObserved()),
  fc.constant(new RegistryUnreadableShapeObserved()),
)

type RawRegistryObservation = RegistryObservation & { readonly cause: string }

const rawRegistryObservation: fc.Arbitrary<RawRegistryObservation> = fc.oneof(
  fc
    .tuple(httpStatus, rawRegistryCause)
    .map(([status, cause]): RawRegistryObservation => ({ _tag: 'RegistryStatusObserved', status, cause })),
  rawRegistryCause.map((cause): RawRegistryObservation => ({ _tag: 'RegistryNoResponseObserved', cause })),
  rawRegistryCause.map((cause): RawRegistryObservation => ({ _tag: 'RegistryUnreadableShapeObserved', cause })),
)

interface ExpectedCause {
  readonly refusalStatus: Option.Option<number>
  readonly variant: Option.Option<AttwFailure['_tag']>
}

const expectedCause = (observation: RegistryObservation): ExpectedCause =>
  Match.value(observation).pipe(
    Match.tag('RegistryNoResponseObserved', (): ExpectedCause => ({
      refusalStatus: Option.none(),
      variant: Option.some('RegistryUnreachable'),
    })),
    Match.tag('RegistryUnreadableShapeObserved', (): ExpectedCause => ({
      refusalStatus: Option.none(),
      variant: Option.some('RegistryBadResponse'),
    })),
    Match.tag('RegistryStatusObserved', ({ status }) =>
      Match.value(status).pipe(
        Match.when(404, (): ExpectedCause => ({
          refusalStatus: Option.none(),
          variant: Option.some('RegistryNotFound'),
        })),
        Match.when(
          (answered: number) => answered >= 200 && answered < 300,
          (): ExpectedCause => ({ refusalStatus: Option.some(status), variant: Option.none() }),
        ),
        Match.orElse((): ExpectedCause => ({
          refusalStatus: Option.none(),
          variant: Option.some('RegistryBadResponse'),
        })),
      )),
    Match.exhaustive,
  )

const classification = (observation: RegistryObservation) =>
  classifyRegistryFailure(new ClassifyRegistryFailureCommand({ observation }))

const boundaryStatuses: fc.Arbitrary<number> = fc.constantFrom(199, 200, 201, 298, 299, 300, 403, 404, 405)

const refusalStatuses: readonly number[] = [200, 201, 298, 299]

it.prop('∀obs_FailureClassify_∈declaredVariant', [registryObservation], ([observation]) => {
  const expected = expectedCause(observation)
  return Match.value(classification(observation)).pipe(
    Match.tag(
      'Failure',
      (refusal) => Option.exists(expected.refusalStatus, (status) => status === refusal.failure.status),
    ),
    Match.tag(
      'Success',
      (success) =>
        Option.exists(expected.variant, (variant) => Predicate.isTagged(success.success, variant)) &&
        success.success.message.length > 0 &&
        success.success.recovery.length > 0,
    ),
    Match.exhaustive,
  )
})

it.prop(
  '∀status_StatusClassBoundary_=classOf(status)',
  [boundaryStatuses],
  ([status]) =>
    Match.value(classification(new RegistryStatusObserved({ status }))).pipe(
      Match.tag('Failure', (refusal) => refusalStatuses.includes(status) && refusal.failure.status === status),
      Match.tag('Success', (success) =>
        Match.value(status).pipe(
          Match.when(404, () => Predicate.isTagged(success.success, 'RegistryNotFound')),
          Match.orElse(() =>
            !refusalStatuses.includes(status) && Predicate.isTagged(success.success, 'RegistryBadResponse')
          ),
        )),
      Match.exhaustive,
    ),
)

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

it.prop('∀failure_FailureDocument_={status,kind,message,recovery}', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  const { document } = failureOutcome(failure, { isTty: false })
  const decoded = decodeFailureDocument(document)
  return Result.isSuccess(decoded) &&
    decoded.success.kind === fields.tag &&
    decoded.success.message === fields.message &&
    decoded.success.recovery === fields.recovery &&
    decoded.success.recovery.length > 0 &&
    JSON.stringify(decoded.success) === document.trimEnd()
})

it.prop('∀failure_FailureTtyDocument_=1line∋recovery', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  const { document } = failureOutcome(failure, { isTty: true })
  const body = document.trimEnd()
  return document.endsWith('\n') &&
    !body.includes('\n') &&
    body.includes(fields.message) &&
    body.includes(fields.recovery)
})

it.prop('∀cause_FailureRender_¬cause', [rawRegistryObservation], ([observation]) => {
  const cause = observation.cause
  return Match.value(classification(observation)).pipe(
    Match.tag('Failure', (refusal) => !JSON.stringify(refusal.failure).includes(cause)),
    Match.tag('Success', (success) => {
      const failure = success.success
      return !failure.message.includes(cause) &&
        !failure.recovery.includes(cause) &&
        !failureOutcome(failure, { isTty: false }).document.includes(cause) &&
        !failureOutcome(failure, { isTty: true }).document.includes(cause)
    }),
    Match.exhaustive,
  )
})

it.prop('∀failure_FailureExit_=1', [failureFields], ([fields]) => {
  const failure = failureFromFields(fields)
  return failureOutcome(failure, { isTty: false }).exitCode === 1 &&
    failureOutcome(failure, { isTty: true }).exitCode === 1
})
