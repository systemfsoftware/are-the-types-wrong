import { Match } from 'effect'

import {
  detectModuleKindDisagreement,
  DetectModuleKindDisagreementCommand,
  type ModuleKindObservation,
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
} from '../../detect-module-kind-disagreement.workflow.js'
import type { ModuleKind, Problem, Resolution, ResolutionOption } from '../../Types.js'
import { isNonEmptyString } from '../../Utils.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'

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
    const typesFileName = resolutionFileName(entrypoint.resolution)
    const implementationFileName = resolutionFileName(entrypoint.implementationResolution)
    return [
      typesFileName,
      implementationFileName,
      moduleKindOf(programInfo, resolutionOption, typesFileName),
      moduleKindOf(programInfo, resolutionOption, implementationFileName),
    ]
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

function resolutionFileName(resolution: Resolution | undefined): string | undefined {
  return resolution?.fileName
}

function moduleKindOf(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionOption: ResolutionOption,
  fileName: string | undefined,
): ModuleKind | undefined {
  if (!isNonEmptyString(fileName)) {
    return undefined
  }
  return moduleKindAt(programInfo, resolutionOption, fileName)
}

function moduleKindAt(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionOption: ResolutionOption,
  fileName: string,
): ModuleKind | undefined {
  return moduleKindsOf(programInfo, resolutionOption)?.[fileName]
}

function moduleKindsOf(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionOption: ResolutionOption,
): Record<string, ModuleKind> | undefined {
  return programInfo[resolutionOption]?.moduleKinds
}
