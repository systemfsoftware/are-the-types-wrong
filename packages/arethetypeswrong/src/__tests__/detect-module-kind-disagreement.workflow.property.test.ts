import { it } from '@effect/vitest'
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

type DecisionChannel = 'refusal' | 'agreement' | 'FalseESM' | 'FalseCJS'

const INTENDED_CHANNEL_BY_KIND_PAIR = {
  [CommonJSModuleKind]: {
    [CommonJSModuleKind]: 'agreement',
    [ESNextModuleKind]: 'FalseCJS',
  },
  [ESNextModuleKind]: {
    [CommonJSModuleKind]: 'FalseESM',
    [ESNextModuleKind]: 'agreement',
  },
} as const

const KIND_PAIRS = [
  { types: CommonJSModuleKind, implementation: CommonJSModuleKind },
  { types: CommonJSModuleKind, implementation: ESNextModuleKind },
  { types: ESNextModuleKind, implementation: CommonJSModuleKind },
  { types: ESNextModuleKind, implementation: ESNextModuleKind },
] as const

const completeObservationArbitrary: fc.Arbitrary<ModuleKindObservationComplete> = fc
  .tuple(fc.constantFrom(...KIND_PAIRS), S.toArbitrary(ModuleKindObservationSchema)(fc))
  .map(
    ([pair, raw]) =>
      new ModuleKindObservationComplete({
        typesFileName: raw.typesFileName ?? 'types.d.ts',
        implementationFileName: raw.implementationFileName ?? 'index.js',
        typesModuleKind: {
          detectedKind: pair.types,
          detectedReason: raw.typesModuleKind?.detectedReason ?? 'extension',
          reasonFileName: raw.typesModuleKind?.reasonFileName ?? 'types.d.ts',
        },
        implementationModuleKind: {
          detectedKind: pair.implementation,
          detectedReason: raw.implementationModuleKind?.detectedReason ?? 'type',
          reasonFileName: raw.implementationModuleKind?.reasonFileName ?? 'index.js',
        },
      }),
  )

const observationArbitrary: fc.Arbitrary<ModuleKindObservation> = fc.oneof(
  S.toArbitrary(ModuleKindObservationSchema)(fc).map(
    (raw): ModuleKindObservation =>
      Match.value({
        typesFileName: raw.typesFileName ?? undefined,
        implementationFileName: raw.implementationFileName ?? undefined,
        typesModuleKind: raw.typesModuleKind ?? undefined,
        implementationModuleKind: raw.implementationModuleKind ?? undefined,
      }).pipe(
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
      ),
  ),
  completeObservationArbitrary,
)

const observedChannel = (observation: ModuleKindObservation): DecisionChannel =>
  Result.match(detectModuleKindDisagreement(new DetectModuleKindDisagreementCommand({ observation })), {
    onFailure: (): DecisionChannel => 'refusal',
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('FalseEsmDeclared', (): DecisionChannel => 'FalseESM'),
        Match.tag('FalseCjsDeclared', (): DecisionChannel => 'FalseCJS'),
        Match.tag('ModuleKindsAgree', (): DecisionChannel => 'agreement'),
        Match.exhaustive,
      ),
  })

const referenceChannel = (observation: ModuleKindObservation): DecisionChannel =>
  Match.value(observation).pipe(
    Match.tag('ModuleKindObservationMissing', (): DecisionChannel => 'refusal'),
    Match.tag('ModuleKindObservationComplete', ({ typesModuleKind, implementationModuleKind }): DecisionChannel => {
      const typesResolvedToEsm = typesModuleKind.detectedKind === ESNextModuleKind
      const implementationResolvedToEsm = implementationModuleKind.detectedKind === ESNextModuleKind
      if (typesResolvedToEsm === implementationResolvedToEsm) {
        return 'agreement'
      }
      if (typesResolvedToEsm) {
        return 'FalseESM'
      }
      return 'FalseCJS'
    }),
    Match.exhaustive,
  )

it.prop('∀observation_ModuleKindDisagreement_≡IntendedChannelTable', [observationArbitrary], ([observation]) => {
  const intended = Match.value(observation).pipe(
    Match.tag('ModuleKindObservationMissing', (): DecisionChannel => 'refusal'),
    Match.tag(
      'ModuleKindObservationComplete',
      ({ typesModuleKind, implementationModuleKind }): DecisionChannel =>
        INTENDED_CHANNEL_BY_KIND_PAIR[typesModuleKind.detectedKind][implementationModuleKind.detectedKind],
    ),
    Match.exhaustive,
  )
  return observedChannel(observation) === intended
})

it.prop(
  '∀observation_ModuleKindDisagreement_≡ReferenceChannel',
  [observationArbitrary],
  ([observation]) => observedChannel(observation) === referenceChannel(observation),
)

it.prop('∀declaration_ModuleKindDisagreement_≡NamesTheEsmSide', [completeObservationArbitrary], ([observation]) => {
  fc.pre(observation.typesModuleKind.detectedKind !== observation.implementationModuleKind.detectedKind)
  return Result.match(detectModuleKindDisagreement(new DetectModuleKindDisagreementCommand({ observation })), {
    onFailure: (): boolean => false,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag(
          'FalseEsmDeclared',
          ({ typesModuleKind, implementationModuleKind }) =>
            typesModuleKind.detectedKind === ESNextModuleKind &&
            implementationModuleKind.detectedKind === CommonJSModuleKind,
        ),
        Match.tag(
          'FalseCjsDeclared',
          ({ typesModuleKind, implementationModuleKind }) =>
            typesModuleKind.detectedKind === CommonJSModuleKind &&
            implementationModuleKind.detectedKind === ESNextModuleKind,
        ),
        Match.tag('ModuleKindsAgree', (): boolean => false),
        Match.exhaustive,
      ),
  })
})
