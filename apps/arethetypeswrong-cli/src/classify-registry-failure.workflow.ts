import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

const RegistryFailureDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/RegistryFailureDecision',
)
type RegistryFailureDecisionTypeId = typeof RegistryFailureDecisionTypeId

export class RegistryStatusObserved extends S.TaggedClass<RegistryStatusObserved>()('RegistryStatusObserved', {
  status: S.Number,
}) {}

export class RegistryNoResponseObserved extends S.TaggedClass<RegistryNoResponseObserved>()(
  'RegistryNoResponseObserved',
  {},
) {}

export class RegistryUnreadableShapeObserved extends S.TaggedClass<RegistryUnreadableShapeObserved>()(
  'RegistryUnreadableShapeObserved',
  {},
) {}

export type RegistryObservation =
  | RegistryStatusObserved
  | RegistryNoResponseObserved
  | RegistryUnreadableShapeObserved

export class ClassifyRegistryFailureCommand extends S.Class<ClassifyRegistryFailureCommand>(
  'ClassifyRegistryFailureCommand',
)({
  observation: S.Union([RegistryStatusObserved, RegistryNoResponseObserved, RegistryUnreadableShapeObserved]),
}) {}

export class RegistryNotFoundDecided extends S.TaggedError<RegistryNotFoundDecided>()('RegistryNotFound', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [RegistryFailureDecisionTypeId] = RegistryFailureDecisionTypeId
}

export class RegistryUnreachableDecided extends S.TaggedError<RegistryUnreachableDecided>()('RegistryUnreachable', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [RegistryFailureDecisionTypeId] = RegistryFailureDecisionTypeId
}

export class RegistryBadResponseDecided extends S.TaggedError<RegistryBadResponseDecided>()('RegistryBadResponse', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [RegistryFailureDecisionTypeId] = RegistryFailureDecisionTypeId
}

export class RegistryAnsweredSuccessfully extends S.TaggedError<RegistryAnsweredSuccessfully>()(
  'RegistryAnsweredSuccessfully',
  { status: S.Number },
) {
  readonly [RegistryFailureDecisionTypeId] = RegistryFailureDecisionTypeId
}

export type RegistryFailureDecision =
  | RegistryNotFoundDecided
  | RegistryUnreachableDecided
  | RegistryBadResponseDecided

const statusClassSchema = S.Literals(['notFound', 'success', 'other'])

type StatusClass = S.Schema.Type<typeof statusClassSchema>

const statusClass = (status: number): StatusClass =>
  Match.value(status === 404).pipe(
    Match.when(true, (): StatusClass => 'notFound'),
    Match.when(false, () =>
      Match.value(status >= 200).pipe(
        Match.when(true, () =>
          Match.value(status < 300).pipe(
            Match.when(true, (): StatusClass => 'success'),
            Match.when(false, (): StatusClass => 'other'),
            Match.exhaustive,
          )),
        Match.when(false, (): StatusClass => 'other'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const registryUnreachable = (): RegistryUnreachableDecided =>
  new RegistryUnreachableDecided({
    message: 'The registry did not answer.',
    recovery: 'Check network access and the --registry URL, then rerun the same command.',
  })

const registryUnreadable = (): RegistryBadResponseDecided =>
  new RegistryBadResponseDecided({
    message: 'The registry answered with a document this tool cannot read.',
    recovery: 'Check network access and the --registry URL, then rerun the same command.',
  })

const registryNotFound = (): RegistryNotFoundDecided =>
  new RegistryNotFoundDecided({
    message: 'The registry has no package or version matching that target.',
    recovery: 'Check the package name and version, then rerun the same command.',
  })

const registryBadResponse = (status: number): RegistryBadResponseDecided =>
  new RegistryBadResponseDecided({
    message: `The registry answered with HTTP ${status}.`,
    recovery: 'Check network access and the --registry URL, then rerun the same command.',
  })

export const classifyRegistryFailure = Workflow.make(
  ClassifyRegistryFailureCommand,
  (command): Result.Result<RegistryFailureDecision, RegistryAnsweredSuccessfully> =>
    Match.value(command.observation).pipe(
      Match.tag('RegistryNoResponseObserved', () => Result.succeed(registryUnreachable())),
      Match.tag('RegistryUnreadableShapeObserved', () => Result.succeed(registryUnreadable())),
      Match.tag('RegistryStatusObserved', ({ status }) =>
        Match.value(statusClass(status)).pipe(
          Match.when('notFound', () => Result.succeed(registryNotFound())),
          Match.when('success', () => Result.fail(new RegistryAnsweredSuccessfully({ status }))),
          Match.when('other', () => Result.succeed(registryBadResponse(status))),
          Match.exhaustive,
        )),
      Match.exhaustive,
    ),
)
