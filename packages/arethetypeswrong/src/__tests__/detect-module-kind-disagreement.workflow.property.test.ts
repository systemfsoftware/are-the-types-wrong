import { it } from '@effect/vitest'
import { detectModuleKindDisagreement as publishedDetectModuleKindDisagreement } from '@systemfsoftware/arethetypeswrong-published'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'

import { ModuleKindObservation as ModuleKindObservationSchema } from '../../tests/__fixtures__/module-kind-observation.schema.js'
import {
  detectModuleKindDisagreement,
  DetectModuleKindDisagreementCommand,
  type ModuleKindObservation,
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
} from '../detect-module-kind-disagreement.workflow.js'
import { CommonJSModuleKind, ESNextModuleKind } from '../ModuleKind.js'
import type { ModuleKind } from '../Problem.schema.js'

type RawObservation = S.Schema.Type<typeof ModuleKindObservationSchema>
type ReportedProblem = {
  readonly kind: 'FalseESM' | 'FalseCJS'
  readonly typesFileName: string
  readonly implementationFileName: string
  readonly typesModuleKind: ModuleKind
  readonly implementationModuleKind: ModuleKind
} | undefined
type ExpectedProblemKind = 'FalseESM' | 'FalseCJS' | null

const observationArbitrary: fc.Arbitrary<RawObservation> = S.toArbitrary(ModuleKindObservationSchema)(fc)

const withDefinedFields = (raw: RawObservation) => ({
  typesFileName: raw.typesFileName ?? undefined,
  implementationFileName: raw.implementationFileName ?? undefined,
  typesModuleKind: raw.typesModuleKind ?? undefined,
  implementationModuleKind: raw.implementationModuleKind ?? undefined,
})

const observationOf = (raw: RawObservation): ModuleKindObservation =>
  Match.value(withDefinedFields(raw)).pipe(
    Match.when(
      {
        typesFileName: Match.nonEmptyString,
        implementationFileName: Match.nonEmptyString,
        typesModuleKind: Match.defined,
        implementationModuleKind: Match.defined,
      },
      (complete) => new ModuleKindObservationComplete(complete),
    ),
    Match.orElse(() => new ModuleKindObservationMissing()),
  )

const reportedProblem = (raw: RawObservation): ReportedProblem =>
  Result.match(
    detectModuleKindDisagreement(new DetectModuleKindDisagreementCommand({ observation: observationOf(raw) })),
    {
      onFailure: (): ReportedProblem => undefined,
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('FalseEsmDeclared', (declared): ReportedProblem => ({
            kind: 'FalseESM',
            typesFileName: declared.typesFileName,
            implementationFileName: declared.implementationFileName,
            typesModuleKind: declared.typesModuleKind,
            implementationModuleKind: declared.implementationModuleKind,
          })),
          Match.tag('FalseCjsDeclared', (declared): ReportedProblem => ({
            kind: 'FalseCJS',
            typesFileName: declared.typesFileName,
            implementationFileName: declared.implementationFileName,
            typesModuleKind: declared.typesModuleKind,
            implementationModuleKind: declared.implementationModuleKind,
          })),
          Match.tag('ModuleKindsAgree', (): ReportedProblem => undefined),
          Match.exhaustive,
        ),
    },
  )

const expectedProblemKind = (raw: RawObservation): ExpectedProblemKind =>
  Match.value(observationOf(raw)).pipe(
    Match.tag('ModuleKindObservationMissing', (): ExpectedProblemKind => null),
    Match.tag('ModuleKindObservationComplete', ({ typesModuleKind, implementationModuleKind }) =>
      Match.value({ types: typesModuleKind.detectedKind, implementation: implementationModuleKind.detectedKind }).pipe(
        Match.when({ types: ESNextModuleKind, implementation: CommonJSModuleKind }, (): ExpectedProblemKind =>
          'FalseESM'),
        Match.when({ types: CommonJSModuleKind, implementation: ESNextModuleKind }, (): ExpectedProblemKind =>
          'FalseCJS'),
        Match.orElse((): ExpectedProblemKind =>
          null
        ),
      )),
    Match.exhaustive,
  )

it.prop(
  '∀observation_ModuleKindDisagreement_≡PublishedDeclaration',
  [observationArbitrary],
  ([observation]) =>
    JSON.stringify(reportedProblem(observation)) ===
      JSON.stringify(publishedDetectModuleKindDisagreement(withDefinedFields(observation))),
)

it.prop('∀observation_ModuleKindDisagreement_≡ExpectedKind', [observationArbitrary], ([observation]) => {
  const reported = reportedProblem(observation)
  const expected = expectedProblemKind(observation)
  return Match.value(reported).pipe(
    Match.when(undefined, () => expected === null),
    Match.orElse((problem) => problem.kind === expected),
  )
})
