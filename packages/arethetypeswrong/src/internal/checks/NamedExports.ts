import { Effect } from 'effect'
import ts from 'typescript'
import type {
  EntrypointResolutionAnalysis,
  ModuleKind,
  Problem,
  Resolution,
  ResolutionKind,
  ResolutionOption,
} from '../../Types.js'
import { getResolutionOption, isNonEmptyString } from '../../Utils.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'
import { getEsmModuleNamespace } from '../esm/EsmNamespace.js'
import type { CompilerHost } from '../MultiCompilerHost.js'
import { getSourceFileSymbol } from '../TsCompat.js'

type NamedExportsDependencies = readonly [
  implementationFileName: string | undefined,
  implementationModuleKind: ModuleKind | undefined,
  typesFileName: string | false | undefined,
  typesModuleKind: ModuleKind | undefined,
  resolutionKind: ResolutionKind,
]

type GatherableNamedExports = readonly [
  implementationFileName: string,
  implementationModuleKind: ModuleKind | undefined,
  typesFileName: string,
  typesModuleKind: ModuleKind | undefined,
  resolutionKind: 'node16-esm',
]

interface NamedExportsSources {
  host: CompilerHost
  typesSourceFile: ts.SourceFile
  typesFileName: string
  implementationFileName: string
}

interface GatheredNamedExports {
  typesSourceFile: ts.SourceFile
  typeChecker: ts.TypeChecker
  typesFileName: string
  implementationFileName: string
}

/** @internal */
export default defineCheck({
  name: 'NamedExports',
  dependencies: ({ entrypoints, subpath, resolutionKind, programInfo }) => {
    const entrypoint = entrypoints[subpath].resolutions[resolutionKind]
    const resolutionOption = getResolutionOption(resolutionKind)
    const typesFileName = typesResolutionFileName(entrypoint)
    const typesModuleKind = moduleKindOf(programInfo, resolutionOption, typesFileName)
    const implementationFileName = implementationResolutionFileName(entrypoint)
    const implementationModuleKind = moduleKindOf(programInfo, resolutionOption, implementationFileName)
    return [implementationFileName, implementationModuleKind, typesFileName, typesModuleKind, resolutionKind]
  },
  gather: (dependencies, context) =>
    Effect.gen(function*() {
      const sources = namedExportsSources(dependencies, context)
      if (sources === undefined) {
        return undefined
      }
      const program = yield* sources.host.createAuxiliaryProgram([sources.typesFileName])
      const typeChecker = program.getTypeChecker()
      return {
        typesSourceFile: sources.typesSourceFile,
        typeChecker,
        typesFileName: sources.typesFileName,
        implementationFileName: sources.implementationFileName,
      }
    }),
  execute: (_dependencies, context, gathered) => {
    if (!gathered) {
      return
    }
    return namedExportsProblem(gathered, context)
  },
})

function typesResolutionFileName(entrypoint: EntrypointResolutionAnalysis): string | false | undefined {
  const resolution = entrypoint.resolution
  if (resolution === undefined) {
    return undefined
  }
  return typeScriptResolutionFileName(resolution)
}

function typeScriptResolutionFileName(resolution: Resolution): string | false {
  return resolution.isTypeScript && resolution.fileName
}

function implementationResolutionFileName(entrypoint: EntrypointResolutionAnalysis): string | undefined {
  return entrypoint.implementationResolution?.fileName
}

function moduleKindOf(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionOption: ResolutionOption,
  fileName: string | false | undefined,
): ModuleKind | undefined {
  if (!isUsableFileName(fileName)) {
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
  return programInfo[resolutionOption].moduleKinds
}

function namedExportsSources(
  dependencies: NamedExportsDependencies,
  context: CheckExecutionContext,
): NamedExportsSources | undefined {
  if (!isGatherableNamedExports(dependencies)) {
    return undefined
  }
  return sourcesFromHost(dependencies, context)
}

function hasGatherableFileNames(
  dependencies: NamedExportsDependencies,
): dependencies is readonly [string, ModuleKind | undefined, string, ModuleKind | undefined, ResolutionKind] {
  return isNonEmptyString(dependencies[0]) && isUsableFileName(dependencies[2])
}

function isUsableFileName(fileName: string | false | undefined): fileName is string {
  return typeof fileName === 'string' && fileName !== ''
}

function isGatherableNamedExports(dependencies: NamedExportsDependencies): dependencies is GatherableNamedExports {
  return hasGatherableFileNames(dependencies) && isNode16EsmCommonJsPair(dependencies)
}

function isNode16EsmCommonJsPair(
  dependencies: NamedExportsDependencies,
): dependencies is GatherableNamedExports {
  return detectsCommonJsModuleKinds(dependencies) && dependencies[4] === 'node16-esm'
}

function detectsCommonJsModuleKinds(dependencies: NamedExportsDependencies): boolean {
  return detectsCommonJsModuleKind(dependencies[1]) && detectsCommonJsModuleKind(dependencies[3])
}

function detectsCommonJsModuleKind(moduleKind: ModuleKind | undefined): boolean {
  return moduleKind?.detectedKind === ts.ModuleKind.CommonJS
}

function sourcesFromHost(
  dependencies: GatherableNamedExports,
  context: CheckExecutionContext,
): NamedExportsSources | undefined {
  const host = context.hosts.findHostForFiles([dependencies[2]])
  if (host === undefined) {
    return undefined
  }
  return sourcesFromSourceFile(dependencies, host)
}

function sourcesFromSourceFile(
  dependencies: GatherableNamedExports,
  host: CompilerHost,
): NamedExportsSources | undefined {
  const typesSourceFile = host.getSourceFile(dependencies[2])
  if (!isAnalyzableTypesSourceFile(typesSourceFile)) {
    return undefined
  }
  return {
    host,
    typesSourceFile,
    typesFileName: dependencies[2],
    implementationFileName: dependencies[0],
  }
}

function isAnalyzableTypesSourceFile(sourceFile: ts.SourceFile | undefined): sourceFile is ts.SourceFile {
  return sourceFile !== undefined && hasModuleExports(sourceFile)
}

function hasModuleExports(sourceFile: ts.SourceFile): boolean {
  return sourceFile.scriptKind !== ts.ScriptKind.JSON && getSourceFileSymbol(sourceFile) !== undefined
}

function namedExportsProblem(gathered: GatheredNamedExports, context: CheckExecutionContext): Problem | undefined {
  if (isArrayLikeModule(gathered)) {
    return undefined
  }
  return missingNamedExportsProblem(gathered, context)
}

function isArrayLikeModule({ typeChecker, typesSourceFile }: GatheredNamedExports): boolean {
  const moduleType = typeChecker.getTypeOfSymbol(typeChecker.resolveExternalModuleSymbol(typesSourceFile.symbol))
  return typeChecker.isArrayLikeType(moduleType) || typeChecker.getPropertyOfType(moduleType, '0') !== undefined
}

function missingNamedExportsProblem(
  gathered: GatheredNamedExports,
  context: CheckExecutionContext,
): Problem | undefined {
  const exports = esmModuleNamespace(context.pkg, gathered.implementationFileName)
  if (exports === undefined) {
    return undefined
  }
  return missingExportsProblem(gathered, exports)
}

function esmModuleNamespace(
  pkg: CheckExecutionContext['pkg'],
  implementationFileName: string,
): readonly string[] | undefined {
  try {
    return getEsmModuleNamespace(pkg, implementationFileName)
  } catch {
    return undefined
  }
}

function missingExportsProblem(gathered: GatheredNamedExports, exports: readonly string[]): Problem | undefined {
  const expectedNames = expectedExportNames(gathered.typesSourceFile, gathered.typeChecker)
  const missing = expectedNames.filter((name) => !exports.includes(name))
  if (missing.length === 0) {
    return undefined
  }
  return {
    kind: 'NamedExports',
    implementationFileName: gathered.implementationFileName,
    typesFileName: gathered.typesFileName,
    isMissingAllNamed: lengthWithoutDefault(missing) === lengthWithoutDefault(expectedNames),
    missing,
  }
}

function expectedExportNames(typesSourceFile: ts.SourceFile, typeChecker: ts.TypeChecker): string[] {
  return Array.from(
    new Set(
      typeChecker
        .getExportsAndPropertiesOfModule(typesSourceFile.symbol)
        .filter((symbol) => {
          return symbol.name !== 'prototype' &&
            (typeChecker.getSymbolFlags(symbol, true) & ts.SymbolFlags.Value) !== 0
        })
        .map((symbol) => symbol.name),
    ),
  )
}

function lengthWithoutDefault(names: readonly string[]): number {
  if (names.includes('default')) {
    return names.length - 1
  }
  return names.length
}
