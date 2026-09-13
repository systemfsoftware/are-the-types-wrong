import ts from 'typescript'
import {
  accessExpressionNameNode,
  isAccessExpression,
  isFunctionExpressionOrArrowFunction,
  isStringOrNumericLiteralLike,
  skipParentheses,
} from './TsCompat.js'
const minifiedVariableAssignmentPattern = /[^\s];(?:var|let|const) [a-zA-Z0-9_]=[^\s]/

/** @internal */
export interface Export {
  name: string
  node: ts.Node
}

/** @internal */
export function getProbableExports(sourceFile: ts.SourceFile): Export[] {
  return firstDefined([
    () => getEsbuildBabelSwcExports(sourceFile),
    () => getWebpackBootstrapExports(sourceFile),
  ]) ?? []
}

function firstDefined<A>(thunks: readonly (() => A | undefined)[]): A | undefined {
  let result: A | undefined
  thunks.some((thunk) => {
    result = thunk()
    return result !== undefined
  })
  return result
}

function andThen<A, B>(value: A | undefined, next: (value: A) => B | undefined): B | undefined {
  if (value === undefined) {
    return undefined
  }
  return next(value)
}

function getEsbuildBabelSwcExports(sourceFile: ts.SourceFile): Export[] | undefined {
  const possibleIndex = indexOfEsbuildExportMarker(sourceFile.text)
  if (!isEsbuildLike(sourceFile.text, possibleIndex)) {
    return undefined
  }
  return getEsbuildExportsInStatementWindow(sourceFile, possibleIndex)
}

function indexOfEsbuildExportMarker(text: string): number {
  const doubleUnderscore = text.indexOf('\n__export(')
  if (doubleUnderscore === -1) {
    return text.indexOf('\n_export(')
  }
  return doubleUnderscore
}

function isEsbuildLike(text: string, possibleIndex: number): boolean {
  return possibleIndex !== -1 || isProbablyMinified(text)
}

function getEsbuildExportsInStatementWindow(sourceFile: ts.SourceFile, possibleIndex: number): Export[] | undefined {
  const candidates = sourceFile.statements.filter((statement) => isInEsbuildStatementWindow(statement, possibleIndex))
  return firstDefined(candidates.map((statement) => () => getEsbuildStatementExports(statement, sourceFile)))
}

function isInEsbuildStatementWindow(statement: ts.Statement, possibleIndex: number): boolean {
  return possibleIndex === -1 || statementContainsIndex(statement, possibleIndex)
}

function statementContainsIndex(statement: ts.Statement, index: number): boolean {
  return statement.pos <= index && index <= statement.end
}

function getEsbuildStatementExports(statement: ts.Statement, sourceFile: ts.SourceFile): Export[] | undefined {
  if (!ts.isExpressionStatement(statement)) {
    return undefined
  }
  return getEsbuildExpressionExports(statement.expression, sourceFile)
}

function getEsbuildExpressionExports(expression: ts.Expression, sourceFile: ts.SourceFile): Export[] | undefined {
  if (!isEsbuildExportCall(expression)) {
    return undefined
  }
  return getEsbuildCallExports(expression, sourceFile)
}

function isEsbuildExportCall(expression: ts.Expression): expression is ts.CallExpression {
  return ts.isCallExpression(expression) && hasEsbuildExportCallShape(expression)
}

function hasEsbuildExportCallShape(call: ts.CallExpression): boolean {
  return ts.isIdentifier(call.expression) && hasEsbuildExportArgumentPair(call.arguments)
}

function hasEsbuildExportArgumentPair(argumentList: ts.NodeArray<ts.Expression>): boolean {
  return argumentList.length === 2 && hasIdentifierAndObjectLiteral(argumentList)
}

function hasIdentifierAndObjectLiteral(argumentList: ts.NodeArray<ts.Expression>): boolean {
  return ts.isIdentifier(argumentList[0]) && ts.isObjectLiteralExpression(argumentList[1])
}

function getEsbuildCallExports(call: ts.CallExpression, sourceFile: ts.SourceFile): Export[] | undefined {
  if (!isEsbuildExportHelperIdentifier(call.expression, sourceFile)) {
    return undefined
  }
  return getObjectLiteralExports(call.arguments[1])
}

function isEsbuildExportHelperIdentifier(callTarget: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return ts.isIdentifier(callTarget) && isEsbuildExportHelper(callTarget, sourceFile)
}

function isEsbuildExportHelper(identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  return isNamedExportHelper(identifier) || isDeclaredExportHelper(identifier, sourceFile)
}

function isNamedExportHelper(identifier: ts.Identifier): boolean {
  return ts.unescapeLeadingUnderscores(identifier.escapedText) === '__export' ||
    identifier.escapedText === '_export'
}

function isDeclaredExportHelper(identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean {
  return isEsbuildExportFunction(getLocalDeclaration(identifier, sourceFile))
}

function getLocalDeclaration(identifier: ts.Identifier, sourceFile: ts.SourceFile): ts.Declaration | undefined {
  return andThen(getLocalSymbol(identifier, sourceFile), (symbol) => symbol.valueDeclaration)
}

function getLocalSymbol(identifier: ts.Identifier, sourceFile: ts.SourceFile): ts.Symbol | undefined {
  return sourceFile.locals?.get(identifier.escapedText)
}

function getObjectLiteralExports(argument: ts.Expression): Export[] {
  if (ts.isObjectLiteralExpression(argument)) {
    return argument.properties.flatMap(getPropertyExports)
  }
  return []
}

function getPropertyExports(property: ts.ObjectLiteralElementLike): Export[] {
  if (ts.isPropertyAssignment(property)) {
    return getNamedExports(property.name, property)
  }
  return getShorthandExports(property)
}

function getNamedExports(name: ts.PropertyName, node: ts.Node): Export[] {
  if (isPropertyNameNode(name)) {
    return [makeExport(name.text, node)]
  }
  return []
}

function isPropertyNameNode(name: ts.Node): name is ts.Identifier | ts.StringLiteralLike | ts.NumericLiteral {
  return ts.isIdentifier(name) || isStringOrNumericLiteralLike(name)
}

function getShorthandExports(property: ts.ObjectLiteralElementLike): Export[] {
  if (ts.isShorthandPropertyAssignment(property)) {
    return [makeExport(property.name.text, property)]
  }
  return []
}

function makeExport(name: string, node: ts.Node): Export {
  return { name, node }
}

function isEsbuildExportFunction(decl: ts.Declaration | undefined): boolean {
  /*
  esbuild:
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  esbuild min:
  b=(o,r)=>{for(var e in r)n(o,e,{get:r[e],enumerable:!0})}

  swc?
  function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
  }
  */
  if (decl === undefined) {
    return false
  }
  return isExportHelperDeclaration(decl)
}

function isExportHelperDeclaration(decl: ts.Declaration): boolean {
  return ts.isVariableDeclaration(decl) && isExportHelperInitializer(decl.initializer)
}

function isExportHelperInitializer(initializer: ts.Expression | undefined): boolean {
  if (initializer === undefined) {
    return false
  }
  return isExportHelperFunction(initializer)
}

function isExportHelperFunction(expression: ts.Expression): boolean {
  return isFunctionExpressionOrArrowFunction(expression) && hasForInBody(expression.body)
}

function hasForInBody(body: ts.ConciseBody): boolean {
  return ts.isBlock(body) && hasSingleForInStatement(body)
}

function hasSingleForInStatement(body: ts.Block): boolean {
  return body.statements.length === 1 && body.statements.some((statement) => ts.isForInStatement(statement))
}

function isProbablyMinified(text: string): boolean {
  return minifiedVariableAssignmentPattern.test(text)
}

function getWebpackBootstrapExports(sourceFile: ts.SourceFile): Export[] | undefined {
  return firstDefined(sourceFile.statements.map((statement) => () => getBootstrapStatementExports(statement)))
}

function getBootstrapStatementExports(statement: ts.Statement): Export[] | undefined {
  if (!ts.isExpressionStatement(statement)) {
    return undefined
  }
  return getModuleExportsAssignmentExports(statement.expression)
}

function getModuleExportsAssignmentExports(expression: ts.Expression): Export[] | undefined {
  if (!isModuleExportsAssignment(expression)) {
    return undefined
  }
  return getBootstrapCallExports(expression)
}

function isModuleExportsAssignment(expression: ts.Expression): expression is ts.BinaryExpression {
  return isEqualsAssignment(expression) && isModuleExports(expression.left)
}

function getBootstrapCallExports(assignment: ts.BinaryExpression): Export[] | undefined {
  const call = skipParentheses(assignment.right)
  if (!ts.isCallExpression(call)) {
    return undefined
  }
  return getBootstrapExports(call)
}

function getBootstrapExports(call: ts.CallExpression): Export[] | undefined {
  const bootstrap = skipParentheses(call.expression)
  const entryModules = getSingleArrayArgumentElements(call)
  if (!isBlockBodyFunction(bootstrap)) {
    return undefined
  }
  return andThen(entryModules, (modules) => getEntryModuleExports(bootstrap.body, modules))
}

function isBlockBodyFunction(node: ts.Node): node is BootstrapFunction {
  return isFunctionExpression(node) && ts.isBlock(node.body)
}

function isFunctionExpression(node: ts.Node | undefined): node is ts.FunctionExpression {
  return node !== undefined && ts.isFunctionExpression(node)
}

interface BootstrapFunction extends ts.FunctionExpression {
  readonly body: ts.Block
}

function getSingleArrayArgumentElements(call: ts.CallExpression): ts.NodeArray<ts.Expression> | undefined {
  const argument = getSingleArgument(call)
  if (!isArrayLiteral(argument)) {
    return undefined
  }
  return argument.elements
}

function isArrayLiteral(node: ts.Node | undefined): node is ts.ArrayLiteralExpression {
  return node !== undefined && ts.isArrayLiteralExpression(node)
}

function getSingleArgument(call: ts.CallExpression): ts.Expression | undefined {
  if (call.arguments.length === 1) {
    return call.arguments[0]
  }
  return undefined
}

function getEntryModuleExports(body: ts.Block, entryModules: ts.NodeArray<ts.Expression>): Export[] | undefined {
  return andThen(
    getWebpackEntryModuleId(body),
    (entryModuleId) =>
      andThen(
        getEntryModule(entryModules, entryModuleId),
        (entryModule) =>
          andThen(getExportsParameterName(entryModule), (exportsParameterName) =>
            collectModuleExports(entryModule, exportsParameterName)),
      ),
  )
}

function getEntryModule(
  entryModules: ts.NodeArray<ts.Expression>,
  entryModuleId: number,
): ts.FunctionExpression | undefined {
  const entryModule = entryModules.at(entryModuleId)
  if (isFunctionExpression(entryModule)) {
    return entryModule
  }
  return undefined
}

function getExportsParameterName(entryModule: ts.FunctionExpression): string | undefined {
  const parameter = entryModule.parameters.at(1)
  if (parameter === undefined) {
    return undefined
  }
  return getIdentifierText(parameter.name)
}

function getIdentifierText(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  return undefined
}

function collectModuleExports(entryModule: ts.FunctionExpression, exportsParameterName: string): Export[] {
  const exports: Export[] = []
  collectModuleExportsFrom(entryModule.body, exportsParameterName, exports)
  return exports
}

function collectModuleExportsFrom(node: ts.Node, exportsParameterName: string, exports: Export[]): void {
  const moduleExport = getModuleExport(node, exportsParameterName)
  if (moduleExport !== undefined) {
    exports.push(moduleExport)
  }
  ts.forEachChild(node, (child) => collectModuleExportsFrom(child, exportsParameterName, exports))
}

function getModuleExport(node: ts.Node, exportsParameterName: string): Export | undefined {
  if (!isExportsParameterAssignment(node, exportsParameterName)) {
    return undefined
  }
  return getAssignmentExport(node)
}

function getAssignmentExport(assignment: ts.BinaryExpression): Export | undefined {
  const target = assignment.left
  if (!isAccessExpression(target)) {
    return undefined
  }
  return andThen(getNameOfAccessExpression(target), (name) => makeExport(name, assignment))
}

function isExportsParameterAssignment(node: ts.Node, exportsParameterName: string): node is ts.BinaryExpression {
  return isEqualsAssignment(node) && isAccessOnIdentifier(node.left, exportsParameterName)
}

function isEqualsAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && isEqualsAssignmentOperator(node)
}

function isEqualsAssignmentOperator(assignment: ts.BinaryExpression): boolean {
  return assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken
}

function isAccessOnIdentifier(expression: ts.Expression, identifierText: string): boolean {
  return isAccessExpression(expression) && hasIdentifierTarget(expression, identifierText)
}

function hasIdentifierTarget(accessExpression: ts.AccessExpression, identifierText: string): boolean {
  return ts.isIdentifier(accessExpression.expression) && accessExpression.expression.text === identifierText
}

function getWebpackEntryModuleId(body: ts.Block): number | undefined {
  return andThen(
    getReturnWithExpression(body),
    (statement) => getWebpackEntryModuleIdFromExpression(statement.expression),
  )
}

function getReturnWithExpression(body: ts.Block): ReturnWithExpression | undefined {
  return body.statements.find((statement): statement is ReturnWithExpression => isReturnWithExpression(statement))
}

function isReturnWithExpression(statement: ts.Statement): statement is ReturnWithExpression {
  return ts.isReturnStatement(statement) && statement.expression !== undefined
}

interface ReturnWithExpression extends ts.ReturnStatement {
  readonly expression: ts.Expression
}

function getWebpackEntryModuleIdFromExpression(expression: ts.Expression): number | undefined {
  const unparenthesized = skipParentheses(expression)
  return getCallEntryModuleId(unparenthesized) ?? getCommaExpressionEntryModuleId(unparenthesized)
}

function getCallEntryModuleId(expression: ts.Expression): number | undefined {
  if (!isSingleArgumentCall(expression)) {
    return undefined
  }
  return getNumericValue(expression.arguments[0])
}

function isSingleArgumentCall(expression: ts.Expression): expression is ts.CallExpression {
  return ts.isCallExpression(expression) && expression.arguments.length === 1
}

function getCommaExpressionEntryModuleId(expression: ts.Expression): number | undefined {
  if (!isCommaExpression(expression)) {
    return undefined
  }
  return getWebpackEntryModuleIdFromExpression(expression.right)
}

function isCommaExpression(expression: ts.Expression): expression is ts.BinaryExpression {
  return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken
}

function getNumericValue(node: ts.Expression): number | undefined {
  const unparenthesized = skipParentheses(node)
  return getNumericLiteralValue(unparenthesized) ?? getAssignedNumericValue(unparenthesized)
}

function getNumericLiteralValue(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) {
    return Number(node.text)
  }
  return undefined
}

function getAssignedNumericValue(node: ts.Expression): number | undefined {
  if (!isEqualsAssignment(node)) {
    return undefined
  }
  return getNumericValue(node.right)
}

function isModuleExports(node: ts.Expression): boolean {
  return isAccessOnIdentifier(node, 'module') && isExportsAccess(node)
}

function isExportsAccess(node: ts.Expression): boolean {
  return isAccessExpression(node) && getNameOfAccessExpression(node) === 'exports'
}

function getNameOfAccessExpression(accessExpression: ts.AccessExpression): string | undefined {
  const node = accessExpressionNameNode(accessExpression)
  if (isAccessNameNode(node)) {
    return node.text
  }
  return undefined
}

function isAccessNameNode(node: ts.Node): node is ts.Identifier | ts.StringLiteralLike {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node)
}
