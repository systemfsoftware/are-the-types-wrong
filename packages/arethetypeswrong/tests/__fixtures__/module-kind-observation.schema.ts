import { ModuleKindSchema } from '@systemfsoftware/arethetypeswrong'
import * as S from 'effect/Schema'

export const ModuleKindObservation = S.Struct({
  typesFileName: S.NullOr(S.String),
  implementationFileName: S.NullOr(S.String),
  typesModuleKind: S.NullOr(ModuleKindSchema),
  implementationModuleKind: S.NullOr(ModuleKindSchema),
})
export type ModuleKindObservation = S.Schema.Type<typeof ModuleKindObservation>
