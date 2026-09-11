import ts from 'typescript'
import { defineCheck } from '../DefineCheck.js'

/** @internal */
export default defineCheck({
  name: 'UnexpectedModuleSyntax',
  enumerateFiles: true,
  dependencies: ({ fileName, resolutionOption, programInfo }) => {
    return [fileName, programInfo[resolutionOption].moduleKinds?.[fileName]]
  },
  execute: ([fileName, expectedModuleKind], context) => {
    if (!expectedModuleKind || !ts.hasJSFileExtension(fileName)) {
      return
    }
    const host = context.hosts.findHostForFiles([fileName]) ?? context.hosts.bundler
    const sourceFile = host.getSourceFile(fileName)
    if (!sourceFile) {
      return
    }
    let syntaxImpliedModuleKind: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined
    if (sourceFile.externalModuleIndicator !== undefined) {
      syntaxImpliedModuleKind = ts.ModuleKind.ESNext
    } else if (sourceFile.commonJsModuleIndicator !== undefined) {
      syntaxImpliedModuleKind = ts.ModuleKind.CommonJS
    }
    if (syntaxImpliedModuleKind !== undefined && expectedModuleKind.detectedKind !== syntaxImpliedModuleKind) {
      // Value cannot be `true` because we set `moduleDetection: "legacy"`
      const externalModuleIndicator = sourceFile.externalModuleIndicator
      let syntax: ts.Node | undefined
      if (externalModuleIndicator !== undefined && externalModuleIndicator !== true) {
        syntax = externalModuleIndicator
      } else {
        syntax = sourceFile.commonJsModuleIndicator
      }
      if (syntax === undefined) {
        return
      }
      return {
        kind: 'UnexpectedModuleSyntax',
        fileName,
        moduleKind: expectedModuleKind,
        syntax: syntaxImpliedModuleKind,
        pos: syntax.getStart(sourceFile),
        end: syntax.end,
      }
    }
  },
})
