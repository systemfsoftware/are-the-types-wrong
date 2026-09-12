import { Match } from 'effect'

import {
  detectModuleKindDisagreement,
  DetectModuleKindDisagreementCommand,
  type ModuleKindObservation,
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
} from '../../detect-module-kind-disagreement.workflow.js'
import type { ModuleKind, Problem } from '../../Types.js'
import { isNonEmptyString } from '../../Utils.js'
import { defineCheck } from '../DefineCheck.js'

const observationOf = (raw: {
  readonly typesFileName: string | undefined
  readonly implementationFileName: string | undefined
  readonly typesModuleKind: ModuleKind | undefined
  readonly implementationModuleKind: ModuleKind | undefined
}): ModuleKindObservation =>
  Match.value(raw).pipe(
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

/** @internal */
export default defineCheck({
  name: 'ModuleKindDisagreement',
  dependencies: ({ entrypoints, subpath, resolutionKind, resolutionOption, programInfo }) => {
    const entrypoint = entrypoints[subpath].resolutions[resolutionKind]
    const typesFileName = entrypoint.resolution?.fileName
    const implementationFileName = entrypoint.implementationResolution?.fileName
    let typesModuleKind: ModuleKind | undefined
    if (isNonEmptyString(typesFileName)) {
      typesModuleKind = programInfo[resolutionOption]?.moduleKinds?.[typesFileName]
    }
    let implementationModuleKind: ModuleKind | undefined
    if (isNonEmptyString(implementationFileName)) {
      implementationModuleKind = programInfo[resolutionOption]?.moduleKinds?.[implementationFileName]
    }
    return [typesFileName, implementationFileName, typesModuleKind, implementationModuleKind]
  },
  execute: ([typesFileName, implementationFileName, typesModuleKind, implementationModuleKind]) => {
    const command = new DetectModuleKindDisagreementCommand({
      observation: observationOf({ typesFileName, implementationFileName, typesModuleKind, implementationModuleKind }),
    })
    return Match.value(detectModuleKindDisagreement(command)).pipe(
      Match.tag('Failure', () => undefined),
      Match.tag('Success', ({ success }) =>
        Match.value(success).pipe(
          Match.tag('FalseEsmDeclared', (declared): Problem => ({
            kind: 'FalseESM',
            typesFileName: declared.typesFileName,
            implementationFileName: declared.implementationFileName,
            typesModuleKind: declared.typesModuleKind,
            implementationModuleKind: declared.implementationModuleKind,
          })),
          Match.tag('FalseCjsDeclared', (declared): Problem => ({
            kind: 'FalseCJS',
            typesFileName: declared.typesFileName,
            implementationFileName: declared.implementationFileName,
            typesModuleKind: declared.typesModuleKind,
            implementationModuleKind: declared.implementationModuleKind,
          })),
          Match.tag('ModuleKindsAgree', () => undefined),
          Match.exhaustive,
        )),
      Match.exhaustive,
    )
  },
})
