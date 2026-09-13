import { Match } from 'effect'

import {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
} from './detect-fallback-condition.workflow.js'
import { ESNextModuleKind } from './ModuleKind.js'
import {
  type EntrypointResolutionAnalysis,
  type ModuleKind,
  type Problem,
  type Resolution,
  type ResolutionKind,
} from './Problem.schema.js'

export interface EntrypointResolutionsInput {
  readonly subpath: string
  readonly entrypoint: EntrypointResolutionAnalysis
  readonly node16ModuleKinds: Record<string, ModuleKind> | undefined
}

const singleProblemList = (problem: Problem | undefined): readonly Problem[] => {
  if (problem === undefined) return []
  return [problem]
}

const isUntypedResolution = (resolution: Resolution): boolean => !resolution.isTypeScript && !resolution.isJson

const untypedResolutionProblem = (
  subpath: string,
  resolution: Resolution,
  resolutionKind: ResolutionKind,
): Problem | undefined => {
  if (isUntypedResolution(resolution)) {
    return { kind: 'UntypedResolution', entrypoint: subpath, resolutionKind }
  }
  return undefined
}

const resolutionProblem = (subpath: string, entrypoint: EntrypointResolutionAnalysis): Problem | undefined => {
  if (entrypoint.resolution === undefined) {
    return { kind: 'NoResolution', entrypoint: subpath, resolutionKind: entrypoint.resolutionKind }
  }
  return untypedResolutionProblem(subpath, entrypoint.resolution, entrypoint.resolutionKind)
}

const moduleKindForFile = (
  moduleKinds: Record<string, ModuleKind>,
  resolution: Resolution | undefined,
): ModuleKind | undefined => {
  if (resolution === undefined) return undefined
  return moduleKinds[resolution.fileName]
}

const moduleKindAt = (
  moduleKinds: Record<string, ModuleKind> | undefined,
  resolution: Resolution | undefined,
): ModuleKind | undefined => {
  if (moduleKinds === undefined) return undefined
  return moduleKindForFile(moduleKinds, resolution)
}

const isEsmModuleKind = (moduleKind: ModuleKind | undefined): boolean => moduleKind?.detectedKind === ESNextModuleKind

const resolvesToEsm = (
  entrypoint: EntrypointResolutionAnalysis,
  node16ModuleKinds: Record<string, ModuleKind> | undefined,
): boolean =>
  isEsmModuleKind(moduleKindAt(node16ModuleKinds, entrypoint.resolution)) ||
  isEsmModuleKind(moduleKindAt(node16ModuleKinds, entrypoint.implementationResolution))

const cjsResolvesToEsmProblem = (
  subpath: string,
  entrypoint: EntrypointResolutionAnalysis,
  node16ModuleKinds: Record<string, ModuleKind> | undefined,
): Problem | undefined => {
  if (resolvesToEsm(entrypoint, node16ModuleKinds)) {
    return { kind: 'CJSResolvesToESM', entrypoint: subpath, resolutionKind: entrypoint.resolutionKind }
  }
  return undefined
}

const moduleKindProblems = (
  subpath: string,
  entrypoint: EntrypointResolutionAnalysis,
  node16ModuleKinds: Record<string, ModuleKind> | undefined,
): readonly Problem[] => {
  if (entrypoint.resolutionKind !== 'node16-cjs') return []
  return singleProblemList(cjsResolvesToEsmProblem(subpath, entrypoint, node16ModuleKinds))
}

const fallbackProblem = (subpath: string, entrypoint: EntrypointResolutionAnalysis): Problem | undefined =>
  Match.value(
    detectFallbackCondition(
      new DetectFallbackConditionCommand({
        observation: Match.value(entrypoint.resolution).pipe(
          Match.when(undefined, () => new ResolutionTracesUnavailable()),
          Match.orElse((resolution) => new ResolutionTracesCollected({ lines: [...resolution.trace] })),
        ),
      }),
    ),
  ).pipe(
    Match.tag('Success', (result) =>
      Match.value(result.success).pipe(
        Match.tag('FallbackConditionDetected', (): Problem => ({
          kind: 'FallbackCondition',
          entrypoint: subpath,
          resolutionKind: entrypoint.resolutionKind,
        })),
        Match.tag('FallbackConditionAbsent', () => undefined),
        Match.exhaustive,
      )),
    Match.tag('Failure', () => undefined),
    Match.exhaustive,
  )

export const detectEntrypointResolutions = (input: EntrypointResolutionsInput): readonly Problem[] => {
  const { subpath, entrypoint, node16ModuleKinds } = input
  if (entrypoint.isWildcard === true) return []
  return [
    ...singleProblemList(resolutionProblem(subpath, entrypoint)),
    ...moduleKindProblems(subpath, entrypoint, node16ModuleKinds),
    ...singleProblemList(fallbackProblem(subpath, entrypoint)),
  ]
}
