import * as S from 'effect/Schema'

import { ModuleKindSchema } from '../../src/Problem.schema.js'

export const ModuleKindObservation = S.Struct({
  typesFileName: S.NullOr(S.String),
  implementationFileName: S.NullOr(S.String),
  typesModuleKind: S.NullOr(ModuleKindSchema),
  implementationModuleKind: S.NullOr(ModuleKindSchema),
})
export type ModuleKindObservation = S.Schema.Type<typeof ModuleKindObservation>
