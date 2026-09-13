import type { Exports } from 'cjs-module-lexer'
import ts from 'typescript'
import { hasModifier } from '../TsCompat.js'

// Note: There is a pretty solid module `es-module-lexer` which performs a similar lexing operation
// as `cjs-module-lexer`, but has some limitations in what it can express. This implementation
// should be more complete.

const noBindings: Exports = { exports: [], reexports: [] }

function* extractPatternElementNames(elements: readonly ts.ArrayBindingElement[]): Iterable<string> {
  for (const element of elements.filter(ts.isBindingElement)) {
    yield* extractDestructedNames(element.name)
  }
}

function* extractDestructedNames(node: ts.BindingName): Iterable<string> {
  if (ts.isIdentifier(node)) {
    yield node.text
    return
  }
  yield* extractPatternElementNames(node.elements)
}

function collectNamedExportNames(bindings: ts.NamedExports): string[] {
  return bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text)
}

function collectNamedExportBindings(bindings: ts.NamedExportBindings): Exports {
  if (ts.isNamedExports(bindings)) {
    return { exports: collectNamedExportNames(bindings), reexports: [] }
  }
  return { exports: [bindings.name.text], reexports: [] }
}

function isStringLiteralExpression(node: ts.Expression | undefined): node is ts.StringLiteral {
  return node !== undefined && ts.isStringLiteral(node)
}

function collectReexportSpecifier(moduleSpecifier: ts.Expression | undefined): Exports {
  if (!isStringLiteralExpression(moduleSpecifier)) {
    return noBindings
  }
  return { exports: [], reexports: [moduleSpecifier.text] }
}

function collectExportDeclarationBindings(declaration: ts.ExportDeclaration): Exports {
  const { exportClause, moduleSpecifier } = declaration
  if (exportClause === undefined) {
    return collectReexportSpecifier(moduleSpecifier)
  }
  return collectNamedExportBindings(exportClause)
}

function collectExportDeclaration(declaration: ts.ExportDeclaration): Exports {
  if (declaration.isTypeOnly) {
    return noBindings
  }
  return collectExportDeclarationBindings(declaration)
}

function collectExportAssignment(statement: ts.ExportAssignment): Exports {
  if (statement.isExportEquals === true) {
    return noBindings
  }
  return { exports: ['default'], reexports: [] }
}

function collectNamedDeclaration(declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports {
  if (declaration.name === undefined) {
    return noBindings
  }
  return { exports: [declaration.name.text], reexports: [] }
}

function collectExportedClassOrFunction(declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports {
  if (hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) {
    return { exports: ['default'], reexports: [] }
  }
  return collectNamedDeclaration(declaration)
}

function collectClassOrFunction(declaration: ts.ClassDeclaration | ts.FunctionDeclaration): Exports {
  if (!hasModifier(declaration, ts.SyntaxKind.ExportKeyword)) {
    return noBindings
  }
  return collectExportedClassOrFunction(declaration)
}

function collectDeclaredNames(declarations: readonly ts.VariableDeclaration[]): string[] {
  return declarations.flatMap((declaration) => [...extractDestructedNames(declaration.name)])
}

function collectVariableStatement(statement: ts.VariableStatement): Exports {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return noBindings
  }
  return { exports: collectDeclaredNames(statement.declarationList.declarations), reexports: [] }
}

function collectStatementExportDeclaration(statement: ts.Statement): Exports | undefined {
  if (ts.isExportDeclaration(statement)) {
    return collectExportDeclaration(statement)
  }
  return undefined
}

function collectStatementExportAssignment(statement: ts.Statement): Exports | undefined {
  if (ts.isExportAssignment(statement)) {
    return collectExportAssignment(statement)
  }
  return undefined
}

function isClassOrFunctionDeclaration(
  statement: ts.Statement,
): statement is ts.ClassDeclaration | ts.FunctionDeclaration {
  return ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)
}

function collectStatementClassOrFunction(statement: ts.Statement): Exports | undefined {
  if (isClassOrFunctionDeclaration(statement)) {
    return collectClassOrFunction(statement)
  }
  return undefined
}

function collectStatementVariableStatement(statement: ts.Statement): Exports | undefined {
  if (ts.isVariableStatement(statement)) {
    return collectVariableStatement(statement)
  }
  return undefined
}

const statementCollectors: readonly ((statement: ts.Statement) => Exports | undefined)[] = [
  collectStatementExportDeclaration,
  collectStatementExportAssignment,
  collectStatementClassOrFunction,
  collectStatementVariableStatement,
]

function collectStatementBindings(statement: ts.Statement): Exports {
  return statementCollectors.reduce<Exports | undefined>(
    (collected, collect) => collected ?? collect(statement),
    undefined,
  ) ?? noBindings
}

function createModuleSourceFile(sourceText: string): ts.SourceFile {
  const options: ts.CreateSourceFileOptions = {
    languageVersion: ts.ScriptTarget.ESNext,
    impliedNodeFormat: ts.ModuleKind.ESNext,
  }
  return ts.createSourceFile('module.cjs', sourceText, options, false, ts.ScriptKind.JS)
}

/** @internal */
export function getEsmModuleBindings(sourceText: string): Exports {
  const bindings = createModuleSourceFile(sourceText).statements.map(collectStatementBindings)
  return {
    exports: bindings.flatMap((collected) => collected.exports),
    reexports: bindings.flatMap((collected) => collected.reexports),
  }
}
