import { Effect } from 'effect'
import ts from 'typescript'
import type { ModuleKind } from '../../Types.js'
import { getResolutionOption, isNonEmptyString } from '../../Utils.js'
import { defineCheck } from '../DefineCheck.js'
import { getEsmModuleNamespace } from '../esm/EsmNamespace.js'
import { getSourceFileSymbol } from '../TsCompat.js'

/** @internal */
export default defineCheck({
  name: 'NamedExports',
  dependencies: ({ entrypoints, subpath, resolutionKind, programInfo }) => {
    const entrypoint = entrypoints[subpath].resolutions[resolutionKind]
    const resolution = entrypoint.resolution
    const implementationResolution = entrypoint.implementationResolution
    const resolutionOption = getResolutionOption(resolutionKind)
    const typesFileName = resolution !== undefined && resolution.isTypeScript && resolution.fileName
    let typesModuleKind: ModuleKind | undefined
    if (typeof typesFileName === 'string' && typesFileName !== '') {
      typesModuleKind = programInfo[resolutionOption].moduleKinds?.[typesFileName]
    }
    const implementationFileName = implementationResolution?.fileName
    let implementationModuleKind: ModuleKind | undefined
    if (isNonEmptyString(implementationFileName)) {
      implementationModuleKind = programInfo[resolutionOption].moduleKinds?.[implementationFileName]
    }
    return [implementationFileName, implementationModuleKind, typesFileName, typesModuleKind, resolutionKind]
  },
  gather: (
    [implementationFileName, implementationModuleKind, typesFileName, typesModuleKind, resolutionKind],
    context,
  ) =>
    Effect.gen(function*() {
      if (
        !isNonEmptyString(implementationFileName) ||
        typeof typesFileName !== 'string' ||
        typesFileName === '' ||
        resolutionKind !== 'node16-esm' ||
        typesModuleKind?.detectedKind !== ts.ModuleKind.CommonJS ||
        implementationModuleKind?.detectedKind !== ts.ModuleKind.CommonJS
      ) {
        return undefined
      }

      const host = context.hosts.findHostForFiles([typesFileName])
      if (!host) {
        return undefined
      }
      const typesSourceFile = host.getSourceFile(typesFileName)
      if (
        !typesSourceFile ||
        typesSourceFile.scriptKind === ts.ScriptKind.JSON ||
        getSourceFileSymbol(typesSourceFile) === undefined
      ) {
        return undefined
      }

      const program = yield* host.createAuxiliaryProgram([typesFileName])
      const typeChecker = program.getTypeChecker()
      return { typesSourceFile, typeChecker, typesFileName, implementationFileName }
    }),
  execute: (_deps, context, gathered) => {
    if (!gathered) {
      return
    }
    const { typesSourceFile, typeChecker, typesFileName, implementationFileName } = gathered

    const moduleType = typeChecker.getTypeOfSymbol(typeChecker.resolveExternalModuleSymbol(typesSourceFile.symbol))
    if (typeChecker.isArrayLikeType(moduleType) || typeChecker.getPropertyOfType(moduleType, '0')) {
      return
    }
    const expectedNames = Array.from(
      new Set(
        typeChecker
          .getExportsAndPropertiesOfModule(typesSourceFile.symbol)
          .filter((symbol) => {
            return (
              symbol.name !== 'prototype' &&
              (typeChecker.getSymbolFlags(symbol, true) & ts.SymbolFlags.Value) !== 0
            )
          })
          .map((symbol) => symbol.name),
      ),
    )

    let exports: readonly string[]
    try {
      exports = getEsmModuleNamespace(context.pkg, implementationFileName)
    } catch {
      return
    }

    const missing = expectedNames.filter((name) => !exports.includes(name))
    if (missing.length > 0) {
      const lengthWithoutDefault = (names: readonly string[]) => {
        if (names.includes('default')) {
          return names.length - 1
        }
        return names.length
      }
      return {
        kind: 'NamedExports',
        implementationFileName,
        typesFileName,
        isMissingAllNamed: lengthWithoutDefault(missing) === lengthWithoutDefault(expectedNames),
        missing,
      }
    }
  },
})
