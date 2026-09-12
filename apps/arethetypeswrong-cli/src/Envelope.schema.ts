import {
  AnalysisTypesSchema,
  EntrypointInfoSchema,
  InternalResolutionErrorProblemSchema,
  ProblemSchema,
  ProgramInfoSchema,
  ResolutionOptionSchema,
} from '@systemfsoftware/arethetypeswrong'
import * as S from 'effect/Schema'

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
