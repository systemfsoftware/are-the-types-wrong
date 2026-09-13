import * as S from 'effect/Schema'

const ModuleKindSchema = S.Struct({
  detectedKind: S.Literals([1, 99]),
  detectedReason: S.Literals(['extension', 'type', 'no:type']),
  reasonFileName: S.String,
})

export const ModuleKindObservation = S.Struct({
  typesFileName: S.NullOr(S.String),
  implementationFileName: S.NullOr(S.String),
  typesModuleKind: S.NullOr(ModuleKindSchema),
  implementationModuleKind: S.NullOr(ModuleKindSchema),
})
export type ModuleKindObservation = S.Schema.Type<typeof ModuleKindObservation>
