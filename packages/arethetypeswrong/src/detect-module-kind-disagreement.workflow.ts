import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

import { ModuleKindSchema } from './Problem.schema.js'

const ModuleKindDisagreementDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/ModuleKindDisagreementDecision',
)
type ModuleKindDisagreementDecisionTypeId = typeof ModuleKindDisagreementDecisionTypeId

export class ModuleKindObservationMissing extends S.TaggedClass<ModuleKindObservationMissing>()(
  'ModuleKindObservationMissing',
  {},
) {}

export class ModuleKindObservationComplete extends S.TaggedClass<ModuleKindObservationComplete>()(
  'ModuleKindObservationComplete',
  {
    typesFileName: S.String,
    implementationFileName: S.String,
    typesModuleKind: ModuleKindSchema,
    implementationModuleKind: ModuleKindSchema,
  },
) {}

export class DetectModuleKindDisagreementCommand extends S.Class<DetectModuleKindDisagreementCommand>(
  'DetectModuleKindDisagreementCommand',
)({
  observation: S.Union([ModuleKindObservationMissing, ModuleKindObservationComplete]),
}) {}

export class FalseEsmDeclared extends S.TaggedClass<FalseEsmDeclared>()('FalseEsmDeclared', {
  typesFileName: S.String,
  implementationFileName: S.String,
  typesModuleKind: ModuleKindSchema,
  implementationModuleKind: ModuleKindSchema,
}) {
  readonly [ModuleKindDisagreementDecisionTypeId] = ModuleKindDisagreementDecisionTypeId
}

export class FalseCjsDeclared extends S.TaggedClass<FalseCjsDeclared>()('FalseCjsDeclared', {
  typesFileName: S.String,
  implementationFileName: S.String,
  typesModuleKind: ModuleKindSchema,
  implementationModuleKind: ModuleKindSchema,
}) {
  readonly [ModuleKindDisagreementDecisionTypeId] = ModuleKindDisagreementDecisionTypeId
}

export class ModuleKindsAgree extends S.TaggedClass<ModuleKindsAgree>()('ModuleKindsAgree', {}) {
  readonly [ModuleKindDisagreementDecisionTypeId] = ModuleKindDisagreementDecisionTypeId
}

export class ModuleKindObservationUnavailable extends S.TaggedError<ModuleKindObservationUnavailable>()(
  'ModuleKindObservationUnavailable',
  {},
) {
  readonly [ModuleKindDisagreementDecisionTypeId] = ModuleKindDisagreementDecisionTypeId
}

export type ModuleKindDisagreementDecision = FalseEsmDeclared | FalseCjsDeclared | ModuleKindsAgree
export type ModuleKindObservation = ModuleKindObservationMissing | ModuleKindObservationComplete

const moduleKindSyntax = { commonJs: 1, esm: 99 } as const

const declaredFalsely = (observation: ModuleKindObservationComplete): ModuleKindDisagreementDecision =>
  Match.value({
    types: observation.typesModuleKind.detectedKind,
    implementation: observation.implementationModuleKind.detectedKind,
  }).pipe(
    Match.when({ types: moduleKindSyntax.esm, implementation: moduleKindSyntax.commonJs }, () =>
      new FalseEsmDeclared({
        typesFileName: observation.typesFileName,
        implementationFileName: observation.implementationFileName,
        typesModuleKind: observation.typesModuleKind,
        implementationModuleKind: observation.implementationModuleKind,
      })),
    Match.when({ types: moduleKindSyntax.commonJs, implementation: moduleKindSyntax.esm }, () =>
      new FalseCjsDeclared({
        typesFileName: observation.typesFileName,
        implementationFileName: observation.implementationFileName,
        typesModuleKind: observation.typesModuleKind,
        implementationModuleKind: observation.implementationModuleKind,
      })),
    Match.orElse(() => new ModuleKindsAgree()),
  )

export const detectModuleKindDisagreement = Workflow.make(
  DetectModuleKindDisagreementCommand,
  (command): Result.Result<ModuleKindDisagreementDecision, ModuleKindObservationUnavailable> =>
    Match.value(command.observation).pipe(
      Match.tag('ModuleKindObservationMissing', () => Result.fail(new ModuleKindObservationUnavailable())),
      Match.tag('ModuleKindObservationComplete', (observation) => Result.succeed(declaredFalsely(observation))),
      Match.exhaustive,
    ),
)
