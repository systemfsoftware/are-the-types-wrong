import {
  AnalysisTypesSchema,
  EntrypointInfoSchema,
  InternalResolutionErrorProblemSchema,
  ProblemSchema,
  ProgramInfoSchema,
  ResolutionOptionSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

const rejectUndeclaredKeys = { onExcessProperty: 'error' } as const

export const MaskedProblemSchema = S.Union([
  ProblemSchema,
  S.Struct({
    ...InternalResolutionErrorProblemSchema.fields,
    trace: S.optionalKey(S.Array(S.String)),
  }),
])

export const OkEnvelopeSchema = S.Struct({
  status: S.Literal('ok'),
  packageName: S.String,
  packageVersion: S.String,
  types: AnalysisTypesSchema,
  problems: S.Array(MaskedProblemSchema),
  problemCounts: S.Record(S.String, S.Number),
  entrypoints: S.optionalKey(S.Record(S.String, EntrypointInfoSchema)),
  buildTools: S.optionalKey(S.Record(S.String, S.String)),
  programInfo: S.optionalKey(S.Record(ResolutionOptionSchema, ProgramInfoSchema)),
})

export const UntypedEnvelopeSchema = S.Struct({
  status: S.Literal('untyped'),
  packageName: S.String,
  packageVersion: S.String,
  types: S.Literal(false),
})

export const MachineEnvelopeSchema = S.Union([OkEnvelopeSchema, UntypedEnvelopeSchema])

export type MachineEnvelope = S.Schema.Type<typeof MachineEnvelopeSchema>
export type OkEnvelope = S.Schema.Type<typeof OkEnvelopeSchema>
export type MaskedProblem = S.Schema.Type<typeof MaskedProblemSchema>

export class EnvelopeDocumentCommand extends S.Class<EnvelopeDocumentCommand>('EnvelopeDocumentCommand')({
  value: S.Unknown,
}) {}

const EnvelopeDocumentDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/EnvelopeDocumentDecision',
)
type EnvelopeDocumentDecisionTypeId = typeof EnvelopeDocumentDecisionTypeId

export class OkEnvelopeAccepted extends S.TaggedClass<OkEnvelopeAccepted>()('OkEnvelopeAccepted', {
  document: OkEnvelopeSchema,
}) {
  readonly [EnvelopeDocumentDecisionTypeId] = EnvelopeDocumentDecisionTypeId
}

export class UntypedEnvelopeAccepted extends S.TaggedClass<UntypedEnvelopeAccepted>()('UntypedEnvelopeAccepted', {
  document: UntypedEnvelopeSchema,
}) {
  readonly [EnvelopeDocumentDecisionTypeId] = EnvelopeDocumentDecisionTypeId
}

export class EnvelopeDocumentRefused extends S.TaggedError<EnvelopeDocumentRefused>()('EnvelopeDocumentRefused', {
  issue: S.String,
}) {
  readonly [EnvelopeDocumentDecisionTypeId] = EnvelopeDocumentDecisionTypeId
}

export type EnvelopeDocumentDecision = OkEnvelopeAccepted | UntypedEnvelopeAccepted

export const decodeEnvelopeDocument = Workflow.make(
  EnvelopeDocumentCommand,
  (command): Result.Result<EnvelopeDocumentDecision, EnvelopeDocumentRefused> =>
    Result.match(S.decodeUnknownResult(MachineEnvelopeSchema, rejectUndeclaredKeys)(command.value), {
      onFailure: (issue) => Result.fail(new EnvelopeDocumentRefused({ issue: issue.message })),
      onSuccess: (document): Result.Result<EnvelopeDocumentDecision, EnvelopeDocumentRefused> =>
        Match.value(document).pipe(
          Match.when({ status: 'ok' }, (ok) => Result.succeed(new OkEnvelopeAccepted({ document: ok }))),
          Match.orElse((untyped) => Result.succeed(new UntypedEnvelopeAccepted({ document: untyped }))),
        ),
    }),
)
