import type { Analysis, CheckResult, Problem } from '@systemfsoftware/arethetypeswrong'
import { Match } from 'effect'

import type { MachineEnvelope } from './decode-envelope-document.workflow.js'
import { renderEnvelopeDocument } from './envelope-document.js'
import { isUntypedResult, problemFlagForKind } from './ProblemUtils.js'
import type { AnsiAnnotation } from './RenderAnsi.js'
import { renderAsciiAnalysis } from './RenderAscii.js'
import { renderTypedAnalysis } from './RenderTyped.js'
import { renderUntyped } from './RenderUntyped.js'
import type { RenderMode } from './select-render-mode.workflow.js'

export type HumanRenderMode = Exclude<RenderMode, 'envelope' | 'quiet'>

export interface RenderOptions {
  readonly format: HumanRenderMode
  readonly ignoreRules: readonly string[]
  readonly useEmoji: boolean
  readonly color: boolean
  readonly summary: boolean
}

type ModeOptions = Omit<RenderOptions, 'format'>

const visibleProblems = (analysis: Analysis, ignoreRules: readonly string[]): readonly Problem[] =>
  analysis.problems.filter((p) => !ignoreRules.includes(problemFlagForKind(p.kind)))

const groupProblem = (grouped: Record<string, Problem[]>, p: Problem): void => {
  grouped[p.kind] = grouped[p.kind] ?? []
  grouped[p.kind].push(p)
}

const groupProblems = (problems: readonly Problem[]): Record<string, Problem[]> => {
  const grouped: Record<string, Problem[]> = {}
  for (const p of problems) {
    groupProblem(grouped, p)
  }
  return grouped
}

const renderSummary = (problems: readonly Problem[]): string => {
  if (problems.length === 0) return 'No problems found.'
  return Object.entries(groupProblems(problems))
    .map(([kind, list]) => `${kind}: ${list.length}`)
    .join('\n')
}

const renderFormatted = (
  analysis: Analysis,
  visible: readonly Problem[],
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  const entrypointNames = Object.keys(analysis.entrypoints)
  return Match.value(options.format).pipe(
    Match.when('ascii', () => renderAsciiAnalysis(entrypointNames, visible, { useEmoji: options.useEmoji })),
    Match.when('table-flipped', () =>
      renderTypedAnalysis(
        entrypointNames,
        visible,
        { flipped: true, useEmoji: options.useEmoji, color: options.color },
        annotations,
      )),
    Match.when('table', () =>
      renderTypedAnalysis(
        entrypointNames,
        visible,
        { flipped: false, useEmoji: options.useEmoji, color: options.color },
        annotations,
      )),
    Match.exhaustive,
  )
}

const summarizedAnalysis = (
  analysis: Analysis,
  visible: readonly Problem[],
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => renderSummary(visible) + '\n' + renderAnalysis(analysis, { ...options, summary: false }, annotations)

const renderEntrypointAnalysis = (
  analysis: Analysis,
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  const visible = visibleProblems(analysis, options.ignoreRules)
  if (options.summary) return summarizedAnalysis(analysis, visible, options, annotations)
  return renderFormatted(analysis, visible, options, annotations)
}

const renderedAnalysis = (
  result: CheckResult,
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  if (isUntypedResult(result)) {
    return renderUntyped({
      packageName: result.packageName,
      packageVersion: result.packageVersion,
      typesPackageName: null,
    })
  }
  return renderEntrypointAnalysis(result, options, annotations)
}

export const renderAnalysis = (
  result: CheckResult,
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation> = {},
): string => renderedAnalysis(result, options, annotations)

export const renderAnalysisForMode = (
  result: CheckResult,
  mode: RenderMode,
  options: ModeOptions,
  envelope: MachineEnvelope,
): string =>
  Match.value(mode).pipe(
    Match.when('quiet', () => ''),
    Match.when('envelope', () => renderEnvelopeDocument(envelope)),
    Match.when('table', () => renderAnalysis(result, { ...options, format: 'table' })),
    Match.when('table-flipped', () => renderAnalysis(result, { ...options, format: 'table-flipped' })),
    Match.when('ascii', () => renderAnalysis(result, { ...options, format: 'ascii' })),
    Match.exhaustive,
  )
