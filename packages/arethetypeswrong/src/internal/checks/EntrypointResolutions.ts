import { Match } from 'effect'
import ts from 'typescript'

import {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  type FallbackConditionDecision,
  type FallbackTraceObservation,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
} from '../../detect-fallback-condition.workflow.js'
import type { EntrypointResolutionAnalysis, ModuleKind, Problem, Resolution, ResolutionKind } from '../../Types.js'
import { type CheckExecutionContext, defineCheck } from '../DefineCheck.js'

/** @internal */
export default defineCheck({
  name: 'EntrypointResolutions',
  dependencies: ({ subpath, resolutionKind }) => [subpath, resolutionKind],
  execute: ([subpath, resolutionKind], context) => {
    const entrypoint = context.entrypoints[subpath].resolutions[resolutionKind]
    if (entrypoint.isWildcard === true) {
      return
    }
    return entrypointResolutionProblems(entrypoint, subpath, resolutionKind, context)
  },
})

function entrypointResolutionProblems(
  entrypoint: EntrypointResolutionAnalysis,
  subpath: string,
  resolutionKind: ResolutionKind,
  context: CheckExecutionContext,
): Problem[] {
  return [
    ...resolutionProblems(entrypoint, subpath, resolutionKind),
    ...cjsResolvesToEsmProblems(entrypoint, subpath, resolutionKind, context),
    ...fallbackConditionProblems(entrypoint, subpath, resolutionKind),
  ]
}

function resolutionProblems(
  entrypoint: EntrypointResolutionAnalysis,
  subpath: string,
  resolutionKind: ResolutionKind,
): Problem[] {
  const resolution = entrypoint.resolution
  if (resolution === undefined) {
    return [{ kind: 'NoResolution', entrypoint: subpath, resolutionKind }]
  }
  return untypedResolutionProblem(resolution, subpath, resolutionKind)
}

function untypedResolutionProblem(
  resolution: Resolution,
  subpath: string,
  resolutionKind: ResolutionKind,
): Problem[] {
  if (hasTypedResolution(resolution)) {
    return []
  }
  return [{ kind: 'UntypedResolution', entrypoint: subpath, resolutionKind }]
}

function hasTypedResolution(resolution: Resolution): boolean {
  return resolution.isTypeScript || resolution.isJson
}

function cjsResolvesToEsmProblems(
  entrypoint: EntrypointResolutionAnalysis,
  subpath: string,
  resolutionKind: ResolutionKind,
  context: CheckExecutionContext,
): Problem[] {
  if (!cjsResolvesToEsm(entrypoint, resolutionKind, context.programInfo)) {
    return []
  }
  return [{ kind: 'CJSResolvesToESM', entrypoint: subpath, resolutionKind }]
}

function cjsResolvesToEsm(
  entrypoint: EntrypointResolutionAnalysis,
  resolutionKind: ResolutionKind,
  programInfo: CheckExecutionContext['programInfo'],
): boolean {
  return resolutionKind === 'node16-cjs' && resolvesToEsm(entrypoint, programInfo)
}

function resolvesToEsm(
  entrypoint: EntrypointResolutionAnalysis,
  programInfo: CheckExecutionContext['programInfo'],
): boolean {
  const resolution = implementationOrTypesResolution(entrypoint)
  if (resolution === undefined) {
    return false
  }
  return node16DetectedKind(resolution.fileName, programInfo) === ts.ModuleKind.ESNext
}

function implementationOrTypesResolution(entrypoint: EntrypointResolutionAnalysis): Resolution | undefined {
  return entrypoint.implementationResolution ?? entrypoint.resolution
}

function node16DetectedKind(
  fileName: string,
  programInfo: CheckExecutionContext['programInfo'],
): ts.ModuleKind | undefined {
  return node16ModuleKind(fileName, programInfo)?.detectedKind
}

function node16ModuleKind(
  fileName: string,
  programInfo: CheckExecutionContext['programInfo'],
): ModuleKind | undefined {
  return programInfo['node16'].moduleKinds?.[fileName]
}

function fallbackConditionProblems(
  entrypoint: EntrypointResolutionAnalysis,
  subpath: string,
  resolutionKind: ResolutionKind,
): Problem[] {
  const result = detectFallbackCondition(
    new DetectFallbackConditionCommand({ observation: resolutionObservation(entrypoint.resolution) }),
  )
  return Match.value(result).pipe(
    Match.tag('Failure', (): Problem[] => []),
    Match.tag('Success', ({ success }) => fallbackConditionProblem(success, subpath, resolutionKind)),
    Match.exhaustive,
  )
}

function resolutionObservation(resolution: Resolution | undefined): FallbackTraceObservation {
  if (resolution === undefined) {
    return new ResolutionTracesUnavailable()
  }
  return new ResolutionTracesCollected({ lines: [...resolution.trace] })
}

function fallbackConditionProblem(
  decision: FallbackConditionDecision,
  subpath: string,
  resolutionKind: ResolutionKind,
): Problem[] {
  return Match.value(decision).pipe(
    Match.tag(
      'FallbackConditionDetected',
      (): Problem[] => [{ kind: 'FallbackCondition', entrypoint: subpath, resolutionKind }],
    ),
    Match.tag('FallbackConditionAbsent', (): Problem[] => []),
    Match.exhaustive,
  )
}
