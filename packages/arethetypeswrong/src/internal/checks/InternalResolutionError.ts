import ts from 'typescript'
import type { InternalResolutionErrorProblem, ResolutionOption } from '../../Types.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'
import type { CompilerHost } from '../MultiCompilerHost.js'

/** @internal */
export default defineCheck({
  name: 'InternalResolutionError',
  enumerateFiles: true,
  dependencies: ({ resolutionOption, fileName }) => [resolutionOption, fileName],
  execute: ([resolutionOption, fileName], context) => {
    if (!ts.hasTSFileExtension(fileName)) {
      return
    }
    return internalResolutionErrors(resolutionOption, fileName, context)
  },
})

interface ImportAnalysis {
  sourceFile: ts.SourceFile
  host: CompilerHost
  resolutionOption: ResolutionOption
  fileName: string
  pkg: CheckExecutionContext['pkg']
}

function internalResolutionErrors(
  resolutionOption: ResolutionOption,
  fileName: string,
  context: CheckExecutionContext,
): InternalResolutionErrorProblem[] | undefined {
  const host = context.hosts[resolutionOption]
  const sourceFile = host.getSourceFile(fileName)
  if (sourceFile === undefined) {
    return undefined
  }
  return importErrors({ sourceFile, host, resolutionOption, fileName, pkg: context.pkg })
}

function importErrors(analysis: ImportAnalysis): InternalResolutionErrorProblem[] | undefined {
  const imports = analysis.sourceFile.imports
  if (imports === undefined) {
    return undefined
  }
  return moduleSpecifierErrors(imports, analysis)
}

function moduleSpecifierErrors(
  imports: readonly ts.StringLiteralLike[],
  analysis: ImportAnalysis,
): InternalResolutionErrorProblem[] {
  const problems: InternalResolutionErrorProblem[] = []
  for (const moduleSpecifier of imports) {
    recordModuleSpecifierError(problems, moduleSpecifier, analysis)
  }
  return problems
}

function recordModuleSpecifierError(
  problems: InternalResolutionErrorProblem[],
  moduleSpecifier: ts.StringLiteralLike,
  analysis: ImportAnalysis,
): void {
  const problem = moduleSpecifierError(moduleSpecifier, analysis)
  if (problem !== undefined) {
    problems.push(problem)
  }
}

function moduleSpecifierError(
  moduleSpecifier: ts.StringLiteralLike,
  analysis: ImportAnalysis,
): InternalResolutionErrorProblem | undefined {
  if (!isAnalyzedReference(moduleSpecifier.text, analysis.pkg.packageName)) {
    return undefined
  }
  return unresolvedReferenceError(moduleSpecifier, analysis)
}

function isAnalyzedReference(reference: string, packageName: string): boolean {
  return isPackageReference(reference, packageName) || isLocalReference(reference)
}

function isPackageReference(reference: string, packageName: string): boolean {
  return reference === packageName || reference.startsWith(`${packageName}/`)
}

function isLocalReference(reference: string): boolean {
  return reference[0] === '#' || ts.pathIsRelative(reference)
}

function unresolvedReferenceError(
  moduleSpecifier: ts.StringLiteralLike,
  analysis: ImportAnalysis,
): InternalResolutionErrorProblem | undefined {
  const resolutionMode = ts.getModeForUsageLocation(
    analysis.sourceFile,
    moduleSpecifier,
    analysis.host.getCompilerOptions(),
  )
  const resolution = requiredResolution(moduleSpecifier, resolutionMode, analysis)
  if (resolution.resolvedModule !== undefined) {
    return undefined
  }
  return unresolvedModuleError(moduleSpecifier, resolutionMode, analysis)
}

function requiredResolution(
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
  analysis: ImportAnalysis,
): ts.ResolvedModuleWithFailedLookupLocations {
  const resolution = analysis.host.getResolvedModule(analysis.sourceFile, moduleSpecifier.text, resolutionMode)
  if (resolution === undefined) {
    throw new Error(`Expected resolution for '${moduleSpecifier.text}' in ${analysis.fileName}`)
  }
  return resolution
}

function unresolvedModuleError(
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
  analysis: ImportAnalysis,
): InternalResolutionErrorProblem {
  return {
    kind: 'InternalResolutionError',
    resolutionOption: analysis.resolutionOption,
    fileName: analysis.fileName,
    moduleSpecifier: moduleSpecifier.text,
    pos: moduleSpecifier.pos,
    end: moduleSpecifier.end,
    resolutionMode,
    trace: requiredTrace(moduleSpecifier, resolutionMode, analysis),
  }
}

function requiredTrace(
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
  analysis: ImportAnalysis,
): string[] {
  const trace = analysis.host.getTrace(analysis.fileName, moduleSpecifier.text, resolutionMode)
  if (trace === undefined) {
    throw new Error(`Expected trace for '${moduleSpecifier.text}' in ${analysis.fileName}`)
  }
  return trace
}
