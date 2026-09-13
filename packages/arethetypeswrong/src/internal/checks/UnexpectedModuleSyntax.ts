import ts from 'typescript'
import type { ModuleKind, Problem } from '../../Types.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'
import type { CompilerHost } from '../MultiCompilerHost.js'

/** @internal */
export default defineCheck({
  name: 'UnexpectedModuleSyntax',
  enumerateFiles: true,
  dependencies: ({ fileName, resolutionOption, programInfo }) => {
    return [fileName, programInfo[resolutionOption].moduleKinds?.[fileName]]
  },
  execute: (dependencies, context) => {
    if (!isInspectableModuleSyntax(dependencies)) {
      return
    }
    return inspectModuleSyntax(dependencies, context)
  },
})

function isInspectableModuleSyntax(
  dependencies: readonly [string, ModuleKind | undefined],
): dependencies is readonly [string, ModuleKind] {
  return dependencies[1] !== undefined && ts.hasJSFileExtension(dependencies[0])
}

interface ImpliedSyntax {
  kind: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS
  node: ts.Node | undefined
}

function inspectModuleSyntax(
  [fileName, expectedModuleKind]: readonly [string, ModuleKind],
  context: CheckExecutionContext,
): Problem | undefined {
  const sourceFile = moduleSyntaxHost(fileName, context).getSourceFile(fileName)
  if (sourceFile === undefined) {
    return undefined
  }
  return unexpectedModuleSyntax(sourceFile, fileName, expectedModuleKind)
}

function moduleSyntaxHost(fileName: string, context: CheckExecutionContext): CompilerHost {
  return context.hosts.findHostForFiles([fileName]) ?? context.hosts.bundler
}

function unexpectedModuleSyntax(
  sourceFile: ts.SourceFile,
  fileName: string,
  expectedModuleKind: ModuleKind,
): Problem | undefined {
  const implied = impliedSyntax(sourceFile)
  if (!disagreesWithExpectedKind(implied, expectedModuleKind)) {
    return undefined
  }
  return moduleSyntaxProblem(sourceFile, fileName, expectedModuleKind, implied)
}

function disagreesWithExpectedKind(
  implied: ImpliedSyntax | undefined,
  expectedModuleKind: ModuleKind,
): implied is ImpliedSyntax {
  return implied !== undefined && implied.kind !== expectedModuleKind.detectedKind
}

function impliedSyntax(sourceFile: ts.SourceFile): ImpliedSyntax | undefined {
  const externalModuleIndicator = sourceFile.externalModuleIndicator
  if (externalModuleIndicator === undefined) {
    return commonJsImpliedSyntax(sourceFile.commonJsModuleIndicator)
  }
  return {
    kind: ts.ModuleKind.ESNext,
    node: moduleSyntaxIndicatorNode(externalModuleIndicator, sourceFile.commonJsModuleIndicator),
  }
}

function moduleSyntaxIndicatorNode(
  externalModuleIndicator: ts.Node | true,
  commonJsModuleIndicator: ts.Node | undefined,
): ts.Node | undefined {
  if (externalModuleIndicator === true) {
    return commonJsModuleIndicator
  }
  return externalModuleIndicator
}

function commonJsImpliedSyntax(commonJsModuleIndicator: ts.Node | undefined): ImpliedSyntax | undefined {
  if (commonJsModuleIndicator === undefined) {
    return undefined
  }
  return { kind: ts.ModuleKind.CommonJS, node: commonJsModuleIndicator }
}

function moduleSyntaxProblem(
  sourceFile: ts.SourceFile,
  fileName: string,
  expectedModuleKind: ModuleKind,
  implied: ImpliedSyntax,
): Problem | undefined {
  const { kind, node } = implied
  if (node === undefined) {
    return undefined
  }
  return {
    kind: 'UnexpectedModuleSyntax',
    fileName,
    moduleKind: expectedModuleKind,
    syntax: kind,
    pos: node.getStart(sourceFile),
    end: node.end,
  }
}
