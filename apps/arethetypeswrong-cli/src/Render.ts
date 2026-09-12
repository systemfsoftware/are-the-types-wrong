import type { Analysis, CheckResult, Problem } from '@systemfsoftware/arethetypeswrong'
import { Match } from 'effect'

import { problemFlagForKind } from './ProblemUtils.js'
import type { AnsiAnnotation } from './RenderAnsi.js'
import { renderAsciiAnalysis } from './RenderAscii.js'
import { renderJson } from './RenderJson.js'
import type { RenderMode } from './RenderMode.schema.js'
import { renderTypedAnalysis } from './RenderTyped.js'
import { renderUntyped } from './RenderUntyped.js'

export type HumanRenderMode = Exclude<RenderMode, 'envelope' | 'quiet'>

export interface RenderOptions {
  readonly format: HumanRenderMode
  readonly ignoreRules: readonly string[]
  readonly useEmoji: boolean
  readonly color: boolean
  readonly summary: boolean
}

type DocumentOptions = Pick<RenderOptions, 'ignoreRules' | 'summary'>

type ModeOptions = Omit<RenderOptions, 'format'>

const isUntyped = (r: CheckResult): r is Extract<CheckResult, { types: false }> => 'types' in r && r.types === false

const visibleProblems = (
  analysis: Analysis,
  options: DocumentOptions,
): readonly Problem[] => analysis.problems.filter((p) => !options.ignoreRules.includes(problemFlagForKind(p.kind)))

const documentValue = (result: CheckResult, options: DocumentOptions): unknown => {
  if (isUntyped(result)) return { analysis: result }
  const visible = visibleProblems(result, options)
  if (!options.summary) return { analysis: result, problems: visible }
  return { analysis: result, problems: visible, summary: renderSummary(visible) }
}

export const renderAnalysisDocument = (result: CheckResult, options: DocumentOptions): string =>
  renderJson(documentValue(result, options), { pretty: false }) + '\n'

export const renderAnalysis = (
  result: CheckResult,
  options: RenderOptions,
  annotations: Record<string, AnsiAnnotation> = {},
): string => {
  if (isUntyped(result)) {
    return renderUntyped({
      packageName: result.packageName,
      packageVersion: result.packageVersion,
      typesPackageName: null,
    })
  }
  const visible = visibleProblems(result, options)
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
): string =>
  Match.value(mode).pipe(
    Match.when('quiet', () => ''),
    Match.when('envelope', () => renderAnalysisDocument(result, options)),
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
