import ts from 'typescript'
import type { ModuleKind } from '../../Types.js'
import { isNonEmptyString } from '../../Utils.js'
import { defineCheck } from '../DefineCheck.js'

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
    if (
      isNonEmptyString(typesFileName) &&
      isNonEmptyString(implementationFileName) &&
      typesModuleKind !== undefined &&
      implementationModuleKind !== undefined
    ) {
      if (
        typesModuleKind.detectedKind === ts.ModuleKind.ESNext &&
        implementationModuleKind.detectedKind === ts.ModuleKind.CommonJS
      ) {
        return {
          kind: 'FalseESM',
          typesFileName,
          implementationFileName,
          typesModuleKind,
          implementationModuleKind,
        }
      } else if (
        typesModuleKind.detectedKind === ts.ModuleKind.CommonJS &&
        implementationModuleKind.detectedKind === ts.ModuleKind.ESNext
      ) {
        return {
          kind: 'FalseCJS',
          typesFileName,
          implementationFileName,
          typesModuleKind,
          implementationModuleKind,
        }
      }
    }
  },
})
