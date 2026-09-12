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

export const renderAnalysis = (
  result: CheckResult,
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation> = {},
): string => {
  if (isUntypedResult(result)) {
    return renderUntyped({
      packageName: result.packageName,
      packageVersion: result.packageVersion,
      typesPackageName: null,
    })
  }
  const visible = visibleProblems(result, options.ignoreRules)
  if (options.summary) {
    return renderSummary(visible) + '\n' + renderAnalysis(result, { ...options, summary: false }, annotations)
  }
  const entrypointNames = Object.keys(result.entrypoints)
  switch (options.format) {
    case 'ascii':
      return renderAsciiAnalysis(entrypointNames, visible, { useEmoji: options.useEmoji })
    case 'table-flipped':
      return renderTypedAnalysis(
        entrypointNames,
        visible,
        { flipped: true, useEmoji: options.useEmoji, color: options.color },
        annotations,
      )
    case 'table':
      return renderTypedAnalysis(
        entrypointNames,
        visible,
        { flipped: false, useEmoji: options.useEmoji, color: options.color },
        annotations,
      )
  }
}

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

const renderSummary = (problems: readonly Problem[]): string => {
  if (problems.length === 0) return 'No problems found.'
  const grouped: Record<string, Problem[]> = {}
  for (const p of problems) {
    grouped[p.kind] = grouped[p.kind] ?? []
    grouped[p.kind].push(p)
  }
  return Object.entries(grouped)
    .map(([kind, list]) => `${kind}: ${list.length}`)
    .join('\n')
}
