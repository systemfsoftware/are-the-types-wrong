import { Match } from 'effect'
import ts from 'typescript'

import {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
} from '../../detect-fallback-condition.workflow.js'
import type { Problem } from '../../Types.js'
import { defineCheck } from '../DefineCheck.js'

/** @internal */
export default defineCheck({
  name: 'EntrypointResolutions',
  dependencies: ({ subpath, resolutionKind }) => [subpath, resolutionKind],
  execute: ([subpath, resolutionKind], context) => {
    const problems: Problem[] = []
    const entrypoint = context.entrypoints[subpath].resolutions[resolutionKind]
    if (entrypoint.isWildcard === true) {
      return
    }

    if (!entrypoint.resolution) {
      problems.push({
        kind: 'NoResolution',
        entrypoint: subpath,
        resolutionKind,
      })
    } else if (!entrypoint.resolution.isTypeScript && !entrypoint.resolution.isJson) {
      problems.push({
        kind: 'UntypedResolution',
        entrypoint: subpath,
        resolutionKind,
      })
    }

    const moduleKinds = context.programInfo['node16'].moduleKinds
    if (
      resolutionKind === 'node16-cjs' &&
      ((!entrypoint.implementationResolution &&
        entrypoint.resolution &&
        moduleKinds?.[entrypoint.resolution.fileName]?.detectedKind === ts.ModuleKind.ESNext) ||
        (entrypoint.implementationResolution &&
          moduleKinds?.[entrypoint.implementationResolution.fileName]?.detectedKind === ts.ModuleKind.ESNext))
    ) {
      problems.push({
        kind: 'CJSResolvesToESM',
        entrypoint: subpath,
        resolutionKind,
      })
    }

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
          Match.tag('FallbackConditionDetected', () => {
            problems.push({
              kind: 'FallbackCondition',
              entrypoint: subpath,
              resolutionKind,
            })
          }),
          Match.tag('FallbackConditionAbsent', () => undefined),
          Match.exhaustive,
        )),
      Match.tag('Failure', () => undefined),
      Match.exhaustive,
    )

    return problems
  },
})
