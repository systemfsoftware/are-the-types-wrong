import ts from 'typescript'
import type { Problem, ResolutionKind } from '../../Types.js'
import { isNonEmptyString } from '../../Utils.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'
import type { CompilerHost } from '../MultiCompilerHost.js'
import { getSourceFileSymbol } from '../TsCompat.js'

/** @internal */
export default defineCheck({
  name: 'CJSOnlyExportsDefault',
  dependencies: ({ entrypoints, subpath, resolutionKind }) => {
    const entrypoint = entrypoints[subpath].resolutions[resolutionKind]
    const implementationFileName = entrypoint.implementationResolution?.fileName
    return [implementationFileName, resolutionKind]
  },
  execute: ([implementationFileName, resolutionKind], context) =>
    cjsOnlyExportsDefaultProblem(implementationFileName, resolutionKind, context),
})

function cjsOnlyExportsDefaultProblem(
  implementationFileName: string | undefined,
  resolutionKind: ResolutionKind,
  context: CheckExecutionContext,
): Problem | undefined {
  if (!isNonEmptyString(implementationFileName)) {
    return undefined
  }
  return implementationFileProblem(implementationFileName, resolutionKind, context)
}

function implementationFileProblem(
  implementationFileName: string,
  resolutionKind: ResolutionKind,
  context: CheckExecutionContext,
): Problem | undefined {
  if (isCjsOnlyResolutionKind(resolutionKind)) {
    return undefined
  }
  return defaultExportProblem(implementationFileName, context)
}

function isCjsOnlyResolutionKind(resolutionKind: ResolutionKind): boolean {
  // Here, we have a CJS file (most likely transpiled ESM) resolving to a
  // CJS transpiled ESM file. This is fine when considered in isolation.
  // The pattern of having `module.exports.default = ...` is a problem
  // primarily because ESM-detected files in Node (and the same files in
  // Webpack/esbuild) will treat `module.exports` as the default export,
  // which is both unexpected and different from Babel-style interop seen
  // in transpiled default imports and most bundler scenarios. But if Node,
  // Webpack, and esbuild never see this file, then it's fine. So, while
  // the problematic pattern is a feature of the file alone, the bad outcome
  // comes from a combination of the file and the module system that imports
  // it. For dual packages that point Node imports and bundlers to a true
  // ESM default export, while pointing requires to this CJS "default export,"
  // we don't want to report a problem.
  //
  // TODO: It would be nice to report this information *somehow*, as neutral
  // metadata attached to the file (c.f. `Analysis["programInfo"]`).
  return resolutionKind === 'node10' || resolutionKind === 'node16-cjs'
}

function defaultExportProblem(implementationFileName: string, context: CheckExecutionContext): Problem | undefined {
  const sourceFile = cjsOnlyHost(implementationFileName, context).getSourceFile(implementationFileName)
  if (sourceFile === undefined) {
    return undefined
  }
  return sourceFileDefaultExportProblem(sourceFile, implementationFileName)
}

function cjsOnlyHost(implementationFileName: string, context: CheckExecutionContext): CompilerHost {
  return context.hosts.findHostForFiles([implementationFileName]) ?? context.hosts.bundler
}

function sourceFileDefaultExportProblem(
  sourceFile: ts.SourceFile,
  implementationFileName: string,
): Problem | undefined {
  const symbolExports = sourceFileSymbolExports(sourceFile)
  if (symbolExports === undefined) {
    return undefined
  }
  return typedExportsProblem(sourceFile, symbolExports, implementationFileName)
}

function sourceFileSymbolExports(sourceFile: ts.SourceFile): ts.SymbolTable | undefined {
  return getSourceFileSymbol(sourceFile)?.exports
}

function typedExportsProblem(
  sourceFile: ts.SourceFile,
  symbolExports: ts.SymbolTable,
  implementationFileName: string,
): Problem | undefined {
  if (!isCjsOnlyExportsDefault(sourceFile, symbolExports)) {
    return undefined
  }
  return exportDeclarationProblem(sourceFile, symbolExports, implementationFileName)
}

function isCjsOnlyExportsDefault(sourceFile: ts.SourceFile, symbolExports: ts.SymbolTable): boolean {
  return isCommonJsOnlyFile(sourceFile) && hasInteropMarkers(symbolExports)
}

function isCommonJsOnlyFile(sourceFile: ts.SourceFile): boolean {
  return sourceFile.externalModuleIndicator === undefined && sourceFile.commonJsModuleIndicator !== undefined
}

function hasInteropMarkers(symbolExports: ts.SymbolTable): boolean {
  return hasDefaultAndEsModuleMarkers(symbolExports) && !symbolExports.has(ts.InternalSymbolName.ExportEquals)
}

function hasDefaultAndEsModuleMarkers(symbolExports: ts.SymbolTable): boolean {
  return symbolExports.has(ts.InternalSymbolName.Default) &&
    symbolExports.has(ts.escapeLeadingUnderscores('__esModule'))
}

function exportDeclarationProblem(
  sourceFile: ts.SourceFile,
  symbolExports: ts.SymbolTable,
  implementationFileName: string,
): Problem | undefined {
  const defaultExport = symbolExports.get(ts.InternalSymbolName.Default)
  if (defaultExport === undefined) {
    return undefined
  }
  return declarationProblem(sourceFile, defaultExport.declarations, implementationFileName)
}

function declarationProblem(
  sourceFile: ts.SourceFile,
  declarations: readonly ts.Declaration[] | undefined,
  implementationFileName: string,
): Problem | undefined {
  const declaration = firstDeclaration(declarations)
  if (declaration === undefined) {
    return undefined
  }
  return {
    kind: 'CJSOnlyExportsDefault',
    fileName: implementationFileName,
    pos: declaration.getStart(sourceFile),
    end: declaration.end,
  }
}

function firstDeclaration(declarations: readonly ts.Declaration[] | undefined): ts.Declaration | undefined {
  return declarations?.[0]
}
