import { resolvedThroughFallback } from './Fallback.js'
import { ESNextModuleKind } from './ModuleKind.js'
import { type EntrypointResolutionAnalysis, type ModuleKind, type Problem } from './Problem.schema.js'

export interface EntrypointResolutionsInput {
  readonly subpath: string
  readonly entrypoint: EntrypointResolutionAnalysis
  readonly node16ModuleKinds: Record<string, ModuleKind> | undefined
}

export const detectEntrypointResolutions = (
  input: EntrypointResolutionsInput,
): readonly Problem[] => {
  const { subpath, entrypoint, node16ModuleKinds } = input
  const problems: Problem[] = []
  if (entrypoint.isWildcard === true) {
    return problems
  }

  if (!entrypoint.resolution) {
    problems.push({
      kind: 'NoResolution',
      entrypoint: subpath,
      resolutionKind: entrypoint.resolutionKind,
    })
  } else if (!entrypoint.resolution.isTypeScript && !entrypoint.resolution.isJson) {
    problems.push({
      kind: 'UntypedResolution',
      entrypoint: subpath,
      resolutionKind: entrypoint.resolutionKind,
    })
  }

  if (entrypoint.resolutionKind === 'node16-cjs') {
    const resolution = entrypoint.resolution
    const implementationResolution = entrypoint.implementationResolution
    let typesModuleKind: ModuleKind | undefined
    if (resolution !== undefined && node16ModuleKinds !== undefined) {
      typesModuleKind = node16ModuleKinds[resolution.fileName]
    }
    let implModuleKind: ModuleKind | undefined
    if (implementationResolution !== undefined && node16ModuleKinds !== undefined) {
      implModuleKind = node16ModuleKinds[implementationResolution.fileName]
    }
    const isTypesESM = typesModuleKind?.detectedKind === ESNextModuleKind
    const isImplESM = implModuleKind?.detectedKind === ESNextModuleKind
    if (isTypesESM || isImplESM) {
      problems.push({
        kind: 'CJSResolvesToESM',
        entrypoint: subpath,
        resolutionKind: entrypoint.resolutionKind,
      })
    }
  }

  if (entrypoint.resolution !== undefined && resolvedThroughFallback(entrypoint.resolution.trace)) {
    problems.push({
      kind: 'FallbackCondition',
      entrypoint: subpath,
      resolutionKind: entrypoint.resolutionKind,
    })
  }

  return problems
}
