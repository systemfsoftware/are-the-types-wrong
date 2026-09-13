import { Effect } from 'effect'
import ts from 'typescript'
import type { ModuleKind, Problem, Resolution, ResolutionKind } from '../../Types.js'
import { getResolutionOption, isDefined, isNonEmptyString } from '../../Utils.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'
import { type Export, getProbableExports } from '../GetProbableExports.js'
import type { CompilerHost } from '../MultiCompilerHost.js'
import { getSourceFileSymbol, isFunctionBlock, typeHasCallOrConstructSignatures } from '../TsCompat.js'

const bindOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  allowJs: true,
  checkJs: true,
}

/** @internal */
export default defineCheck({
  name: 'ExportDefaultDisagreement',
  dependencies: ({ entrypoints, subpath, resolutionKind, programInfo }) => {
    const entrypoint = entrypoints[subpath].resolutions[resolutionKind]
    const typesFileName = resolutionFileName(entrypoint.resolution)
    const implementationFileName = resolutionFileName(entrypoint.implementationResolution)
    if (resolutionDetectsEsm(programInfo, resolutionKind, typesFileName, implementationFileName)) {
      return []
    }
    return [typesFileName, implementationFileName]
  },
  gather: ([typesFileName, implementationFileName], context) =>
    Effect.gen(function*() {
      const sources = gatherableSources(typesFileName, implementationFileName, context)
      if (sources === undefined) {
        return undefined
      }

      const implChecker = (yield* sources.host.createAuxiliaryProgram([sources.implementationFileName]))
        .getTypeChecker()
      const typesChecker = (yield* sources.host.createAuxiliaryProgram([sources.typesFileName])).getTypeChecker()

      return {
        typesFileName: sources.typesFileName,
        implementationFileName: sources.implementationFileName,
        typesSourceFile: sources.typesSourceFile,
        implementationSourceFile: sources.implementationSourceFile,
        typesExports: sources.typesExports,
        implementationExports: sources.implementationExports,
        implChecker,
        typesChecker,
      }
    }),
  execute: ([_typesFileName, _implementationFileName], _context, gathered) => {
    if (!gathered) {
      return
    }
    return analyzeExportDefaultDisagreement(gathered)
  },
})

interface DisagreementAnalysis {
  typesFileName: string
  implementationFileName: string
  typesSourceFile: ts.SourceFile
  implementationSourceFile: ts.SourceFile
  typesExports: ts.SymbolTable
  implementationExports: ts.SymbolTable
  implChecker: ts.TypeChecker
  typesChecker: ts.TypeChecker
}

interface AnalysisMemo {
  implProbableExports?: Export[]
  implHasDefault?: boolean
  implTypeOfModuleExports?: ts.Type
  implExportEqualsIsExportDefault?: boolean
  typesDefaultSymbol?: ts.Symbol
  typesTypeOfDefault?: ts.Type
}

interface HostedFileNames {
  typesFileName: string
  implementationFileName: string
  host: CompilerHost
}

interface BoundSourceFiles extends HostedFileNames {
  typesSourceFile: ts.SourceFile
  implementationSourceFile: ts.SourceFile
}

interface DisagreementSources {
  typesFileName: string
  implementationFileName: string
  typesSourceFile: ts.SourceFile
  implementationSourceFile: ts.SourceFile
  typesExports: ts.SymbolTable
  implementationExports: ts.SymbolTable
  host: CompilerHost
}

function resolutionFileName(resolution: Resolution | undefined): string | undefined {
  return resolution?.fileName
}

function resolutionDetectsEsm(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionKind: ResolutionKind,
  typesFileName: string | undefined,
  implementationFileName: string | undefined,
): boolean {
  return detectsEsmModuleKind(programInfo, resolutionKind, typesFileName) ||
    detectsEsmModuleKind(programInfo, resolutionKind, implementationFileName)
}

function detectsEsmModuleKind(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionKind: ResolutionKind,
  fileName: string | undefined,
): boolean {
  return isNonEmptyString(fileName) &&
    detectedModuleKindAt(programInfo, resolutionKind, fileName) === ts.ModuleKind.ESNext
}

function detectedModuleKindAt(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionKind: ResolutionKind,
  fileName: string,
): ts.ModuleKind | undefined {
  return detectedModuleKind(programInfo, resolutionKind, fileName)?.detectedKind
}

function detectedModuleKind(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionKind: ResolutionKind,
  fileName: string,
): ModuleKind | undefined {
  return moduleKindsOf(programInfo, resolutionKind)?.[fileName]
}

function moduleKindsOf(
  programInfo: CheckExecutionContext['programInfo'],
  resolutionKind: ResolutionKind,
): Record<string, ModuleKind> | undefined {
  return programInfo[getResolutionOption(resolutionKind)].moduleKinds
}

function gatherableSources(
  typesFileName: string | undefined,
  implementationFileName: string | undefined,
  context: CheckExecutionContext,
): DisagreementSources | undefined {
  const fileNames: readonly [string | undefined, string | undefined] = [typesFileName, implementationFileName]
  if (!hasGatherableFileNames(fileNames)) {
    return undefined
  }
  return sourcesForHost(fileNames, context)
}

function hasGatherableFileNames(
  fileNames: readonly [string | undefined, string | undefined],
): fileNames is readonly [string, string] {
  return hasNonEmptyFileNames(fileNames) && ts.hasTSFileExtension(fileNames[0])
}

function hasNonEmptyFileNames(
  fileNames: readonly [string | undefined, string | undefined],
): fileNames is readonly [string, string] {
  return isNonEmptyString(fileNames[0]) && isNonEmptyString(fileNames[1])
}

function sourcesForHost(
  [typesFileName, implementationFileName]: readonly [string, string],
  context: CheckExecutionContext,
): DisagreementSources | undefined {
  const host = context.hosts.findHostForFiles([typesFileName])
  if (host === undefined) {
    return undefined
  }
  return boundSourceFiles({ typesFileName, implementationFileName, host })
}

function boundSourceFiles(pair: HostedFileNames): DisagreementSources | undefined {
  const typesSourceFile = pair.host.getSourceFile(pair.typesFileName)
  if (typesSourceFile === undefined) {
    return undefined
  }
  return implementationSourceFiles(pair, typesSourceFile)
}

function implementationSourceFiles(
  pair: HostedFileNames,
  typesSourceFile: ts.SourceFile,
): DisagreementSources | undefined {
  const implementationSourceFile = pair.host.getSourceFile(pair.implementationFileName)
  if (implementationSourceFile === undefined) {
    return undefined
  }
  ts.bindSourceFile(typesSourceFile, bindOptions)
  ts.bindSourceFile(implementationSourceFile, bindOptions)
  return collectedExports({ ...pair, typesSourceFile, implementationSourceFile })
}

function collectedExports(sources: BoundSourceFiles): DisagreementSources | undefined {
  const typesExports = moduleExports(getSourceFileSymbol(sources.typesSourceFile))
  if (typesExports === undefined) {
    return undefined
  }
  return implementationExportsCollected(sources, typesExports)
}

function implementationExportsCollected(
  sources: BoundSourceFiles,
  typesExports: ts.SymbolTable,
): DisagreementSources | undefined {
  const implementationExports = moduleExports(getSourceFileSymbol(sources.implementationSourceFile))
  if (implementationExports === undefined) {
    return undefined
  }
  return analyzedSources(sources, typesExports, implementationExports)
}

function moduleExports(symbol: ts.Symbol | undefined): ts.SymbolTable | undefined {
  return symbol?.exports
}

function analyzedSources(
  sources: BoundSourceFiles,
  typesExports: ts.SymbolTable,
  implementationExports: ts.SymbolTable,
): DisagreementSources | undefined {
  if (sources.implementationSourceFile.externalModuleIndicator !== undefined) {
    return undefined
  }
  return {
    typesFileName: sources.typesFileName,
    implementationFileName: sources.implementationFileName,
    typesSourceFile: sources.typesSourceFile,
    implementationSourceFile: sources.implementationSourceFile,
    typesExports,
    implementationExports,
    host: sources.host,
  }
}

function analyzeExportDefaultDisagreement(input: DisagreementAnalysis): Problem | undefined {
  const memo: AnalysisMemo = {}
  const falseExportDefault = falseExportDefaultProblem(input, memo)
  if (falseExportDefault !== undefined) {
    return falseExportDefault
  }
  return missingExportEqualsProblem(input, memo)
}

function falseExportDefaultProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!input.typesExports.has(ts.InternalSymbolName.Default)) {
    return undefined
  }
  return implWithoutDefaultProblem(input, memo)
}

function implWithoutDefaultProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (getImplHasDefault(input, memo)) {
    return undefined
  }
  return analyzableImplProblem(input, memo)
}

function analyzableImplProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!implIsAnalyzable(input, memo)) {
    return undefined
  }
  return {
    kind: 'FalseExportDefault',
    typesFileName: input.typesFileName,
    implementationFileName: input.implementationFileName,
  }
}

function missingExportEqualsProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!implDefaultAndAnalyzable(input, memo)) {
    return undefined
  }
  return exportEqualsProblems(input, memo)
}

function implDefaultAndAnalyzable(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return getImplHasDefault(input, memo) && implIsAnalyzable(input, memo)
}

function exportEqualsProblems(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  const declarationsProblem = exportEqualsDeclarationsProblem(input, memo)
  if (declarationsProblem !== undefined) {
    return declarationsProblem
  }
  return objectyDefaultMismatchProblem(input, memo)
}

function exportEqualsDeclarationsProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!missingExportEqualsDeclarations(input, memo)) {
    return undefined
  }
  return missingExportEquals(input)
}

function missingExportEqualsDeclarations(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return !input.typesExports.has(ts.InternalSymbolName.ExportEquals) && implementationHasExportEquals(input, memo)
}

function implementationHasExportEquals(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return input.implementationExports.has(ts.InternalSymbolName.ExportEquals) && hasDefaultSymbolMismatch(input, memo)
}

function hasDefaultSymbolMismatch(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return getTypesDefaultSymbol(input, memo) !== undefined && signaturesMismatch(input, memo)
}

function signaturesMismatch(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return exportEqualsIsDefaultSignature(input, memo) || moduleExportsSignature(input, memo)
}

function exportEqualsIsDefaultSignature(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return getImplExportEqualsIsExportDefault(input, memo) &&
    typeHasCallOrConstructSignatures(input.typesChecker, getTypesTypeOfDefault(input, memo))
}

function moduleExportsSignature(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return typeHasCallOrConstructSignatures(input.implChecker, getImplTypeOfModuleExports(input, memo))
}

function objectyDefaultMismatchProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (hasNonDefaultValueExport(input)) {
    return undefined
  }
  return objectyDefaultProblem(input, memo)
}

function objectyDefaultProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!typeIsObjecty(getTypesTypeOfDefault(input, memo), input.typesChecker)) {
    return undefined
  }
  return implNonDefaultExportProblem(input, memo)
}

function implNonDefaultExportProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (!implHasNonDefaultExport(input, memo)) {
    return undefined
  }
  return typesDefaultSymbolProblem(input, memo)
}

function typesDefaultSymbolProblem(input: DisagreementAnalysis, memo: AnalysisMemo): Problem | undefined {
  if (getTypesDefaultSymbol(input, memo) === undefined) {
    return undefined
  }
  return missingExportEquals(input)
}

function missingExportEquals(input: DisagreementAnalysis): Problem {
  return {
    kind: 'MissingExportEquals',
    typesFileName: input.typesFileName,
    implementationFileName: input.implementationFileName,
  }
}

function hasNonDefaultValueExport(input: DisagreementAnalysis): boolean {
  return Array.from(input.typesExports.values()).some((symbol) => isNonDefaultValueExport(symbol, input.typesChecker))
}

function implHasNonDefaultExport(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return implementationExportsHaveNonDefault(input) ||
    getImplProbableExports(input, memo).some(({ name }) => isNotDefaultOrEsModule(name))
}

function implementationExportsHaveNonDefault(input: DisagreementAnalysis): boolean {
  return Array.from(input.implementationExports.keys()).some((name) =>
    isNotDefaultOrEsModule(ts.unescapeLeadingUnderscores(name))
  )
}

function isNonDefaultValueExport(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (symbol.escapedName === 'default') {
    return false
  }
  return isValueSymbol(symbol, checker)
}

function isValueSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (symbol.flags & ts.SymbolFlags.Value) {
    return true
  }
  return isAliasValueSymbol(symbol, checker)
}

function isAliasValueSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (symbol.flags & ts.SymbolFlags.Alias) {
    return isValueSymbol(checker.getAliasedSymbol(symbol), checker)
  }
  return false
}

function getImplProbableExports(input: DisagreementAnalysis, memo: AnalysisMemo): Export[] {
  if (memo.implProbableExports === undefined) {
    memo.implProbableExports = getProbableExports(input.implementationSourceFile)
  }
  return memo.implProbableExports
}

function getImplHasDefault(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  if (memo.implHasDefault === undefined) {
    memo.implHasDefault = implHasDefault(input, memo)
  }
  return memo.implHasDefault
}

function implHasDefault(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return hasSyntacticImplDefault(input) || hasAnyImplDefault(input, memo)
}

function hasAnyImplDefault(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return hasProbableImplDefault(input, memo) || hasCheckerImplDefault(input)
}

function hasSyntacticImplDefault(input: DisagreementAnalysis): boolean {
  return input.implementationExports.has(ts.InternalSymbolName.Default) === true
}

function hasProbableImplDefault(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return getImplProbableExports(input, memo).some((symbol) => symbol.name === 'default')
}

function hasCheckerImplDefault(input: DisagreementAnalysis): boolean {
  return input.implementationExports.size > 0 && checkerExportsIncludeDefault(input)
}

function checkerExportsIncludeDefault(input: DisagreementAnalysis): boolean {
  return input.implChecker
    .getExportsAndPropertiesOfModule(input.implementationSourceFile.symbol)
    .some((symbol) => symbol.name === 'default')
}

function implIsAnalyzable(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  if (!hasSharedExportEqualsContainer(input)) {
    return false
  }
  return implExportsAreAnalyzable(input, memo)
}

function hasSharedExportEqualsContainer(input: DisagreementAnalysis): boolean {
  const declarations = exportEqualsDeclarations(input)
  if (declarations === undefined) {
    return true
  }
  return sharesContainer(declarations)
}

function sharesContainer(declarations: readonly ts.Declaration[]): boolean {
  const containers = declarations.map(declarationContainer)
  const firstDefined = containers.findIndex(isDefined)
  if (firstDefined === -1) {
    return true
  }
  return sameContainerAfter(containers, firstDefined)
}

function sameContainerAfter(containers: readonly (ts.Node | undefined)[], firstDefined: number): boolean {
  const container = containers[firstDefined]
  return containers.every((other, index) => index <= firstDefined || other === container)
}

function declarationContainer(declaration: ts.Declaration): ts.Node | undefined {
  return ts.findAncestor(declaration, (node) => isFunctionBlock(node) || ts.isSourceFile(node))
}

function implExportsAreAnalyzable(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  return input.implementationExports.size > 0 || getImplProbableExports(input, memo).length > 0
}

function exportEqualsDeclarations(input: DisagreementAnalysis): readonly ts.Declaration[] | undefined {
  return input.implementationExports.get(ts.InternalSymbolName.ExportEquals)?.declarations
}

function getTypesDefaultSymbol(input: DisagreementAnalysis, memo: AnalysisMemo): ts.Symbol | undefined {
  if (memo.typesDefaultSymbol === undefined) {
    memo.typesDefaultSymbol = typesDefaultSymbol(input)
  }
  return memo.typesDefaultSymbol
}

function typesDefaultSymbol(input: DisagreementAnalysis): ts.Symbol | undefined {
  return input.typesExports.get(ts.InternalSymbolName.Default) ??
    input.typesChecker
      .getExportsAndPropertiesOfModule(input.typesSourceFile.symbol)
      .find((symbol) => symbol.escapedName === 'default')
}

function getTypesTypeOfDefault(input: DisagreementAnalysis, memo: AnalysisMemo): ts.Type {
  if (memo.typesTypeOfDefault === undefined) {
    memo.typesTypeOfDefault = typesTypeOfDefault(input, memo)
  }
  return memo.typesTypeOfDefault
}

function typesTypeOfDefault(input: DisagreementAnalysis, memo: AnalysisMemo): ts.Type {
  const symbol = getTypesDefaultSymbol(input, memo)
  if (symbol === undefined) {
    return input.typesChecker.getAnyType()
  }
  return input.typesChecker.getTypeOfSymbol(symbol)
}

function getImplTypeOfModuleExports(input: DisagreementAnalysis, memo: AnalysisMemo): ts.Type {
  if (memo.implTypeOfModuleExports === undefined) {
    memo.implTypeOfModuleExports = implTypeOfModuleExports(input, memo)
  }
  return memo.implTypeOfModuleExports
}

function implTypeOfModuleExports(input: DisagreementAnalysis, memo: AnalysisMemo): ts.Type {
  const checker = input.implChecker
  const type = checker.getTypeOfSymbol(checker.resolveExternalModuleSymbol(input.implementationSourceFile.symbol))
  if (!isAnyType(type)) {
    return type
  }
  return anyTypeDefaultExport(input, memo, type)
}

function anyTypeDefaultExport(input: DisagreementAnalysis, memo: AnalysisMemo, type: ts.Type): ts.Type {
  if (!getImplExportEqualsIsExportDefault(input, memo)) {
    return type
  }
  return defaultExportType(input, type)
}

function defaultExportType(input: DisagreementAnalysis, fallback: ts.Type): ts.Type {
  const defaultSymbol = input.implementationExports.get(ts.InternalSymbolName.Default)
  if (defaultSymbol === undefined) {
    return fallback
  }
  return nonAnyDefaultType(input.implChecker, defaultSymbol, fallback)
}

function nonAnyDefaultType(checker: ts.TypeChecker, defaultSymbol: ts.Symbol, fallback: ts.Type): ts.Type {
  const defaultType = checker.getTypeOfSymbol(defaultSymbol)
  if (isAnyType(defaultType)) {
    return fallback
  }
  return defaultType
}

function isAnyType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Any) !== 0
}

function getImplExportEqualsIsExportDefault(input: DisagreementAnalysis, memo: AnalysisMemo): boolean {
  if (memo.implExportEqualsIsExportDefault === undefined) {
    memo.implExportEqualsIsExportDefault = exportEqualsIsExportDefault(input)
  }
  return memo.implExportEqualsIsExportDefault
}

function exportEqualsIsExportDefault(input: DisagreementAnalysis): boolean {
  const declaration = exportEqualsDeclaration(input)
  if (declaration === undefined) {
    return false
  }
  return exportAssignmentTargetIsDefault(declaration)
}

function exportAssignmentTargetIsDefault(declaration: ts.Declaration): boolean {
  if (!ts.isExportAssignment(declaration)) {
    return false
  }
  return targetIsExportDefault(declaration.expression)
}

function exportEqualsDeclaration(input: DisagreementAnalysis): ts.Declaration | undefined {
  const declarations = exportEqualsDeclarations(input)
  return declarations?.[0]
}

function targetIsExportDefault(target: ts.Expression): boolean {
  if (isModuleExportsOrExportsDefault(target)) {
    return true
  }
  return assignmentChainIsExportDefault(target)
}

function isModuleExportsOrExportsDefault(target: ts.Expression): boolean {
  return isModuleExports(target) || isExportsDefault(target)
}

function assignmentChainIsExportDefault(target: ts.Expression): boolean {
  if (!ts.isBinaryExpression(target)) {
    return false
  }
  return forEachAssignmentTarget(target, exportDefaultTarget) === true
}

function exportDefaultTarget(target: ts.Expression): true | undefined {
  if (!isModuleExportsOrExportsDefault(target)) {
    return undefined
  }
  return true
}

function typeIsObjecty(type: ts.Type, checker: ts.TypeChecker): boolean {
  return !!(type.flags & ts.TypeFlags.Object) && !typeHasCallOrConstructSignatures(checker, type)
}

function isModuleExports(target: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(target) && isModuleExportsProperty(target)
}

function isModuleExportsProperty(access: ts.PropertyAccessExpression): boolean {
  return access.name.text === 'exports' && isModuleIdentifier(access.expression)
}

function isModuleIdentifier(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === 'module'
}

function isExportsDefault(target: ts.Expression): boolean {
  return isExportsDefaultPropertyAccess(target) || isExportsDefaultElementAccess(target)
}

function isExportsDefaultPropertyAccess(target: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(target) && isDefaultExportsProperty(target)
}

function isDefaultExportsProperty(access: ts.PropertyAccessExpression): boolean {
  return access.name.text === 'default' && isExportsIdentifier(access.expression)
}

function isExportsDefaultElementAccess(target: ts.Expression): boolean {
  return ts.isElementAccessExpression(target) && isDefaultExportsElement(target)
}

function isDefaultExportsElement(access: ts.ElementAccessExpression): boolean {
  return isDefaultElementArgument(access.argumentExpression) && isExportsIdentifier(access.expression)
}

function isDefaultElementArgument(argument: ts.Expression): boolean {
  return ts.isStringLiteralLike(argument) && argument.text === 'default'
}

function isExportsIdentifier(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === 'exports'
}

function isNotDefaultOrEsModule(name: string): boolean {
  return name !== 'default' && name !== '__esModule'
}

function forEachAssignmentTarget<ReturnT>(
  assignment: ts.BinaryExpression,
  cb: (target: ts.Expression) => ReturnT | undefined,
): ReturnT | undefined {
  if (!isEqualsAssignment(assignment)) {
    return
  }
  return firstMatchingAssignmentTarget(assignment, cb)
}

function firstMatchingAssignmentTarget<ReturnT>(
  assignment: ts.BinaryExpression,
  cb: (target: ts.Expression) => ReturnT | undefined,
): ReturnT | undefined {
  const result = cb(assignment.left)
  if (result !== undefined) {
    return result
  }
  return forEachNestedAssignmentTarget(assignment, cb)
}

function isEqualsAssignment(expression: ts.Expression): expression is ts.BinaryExpression {
  return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
}

function forEachNestedAssignmentTarget<ReturnT>(
  assignment: ts.BinaryExpression,
  cb: (target: ts.Expression) => ReturnT | undefined,
): ReturnT | undefined {
  if (!isEqualsAssignment(assignment.right)) {
    return undefined
  }
  return forEachAssignmentTarget(assignment.right, cb)
}
