import type {
  Analysis,
  CheckResult,
  InternalResolutionErrorProblem,
  Problem,
  UntypedResult,
} from '@systemfsoftware/arethetypeswrong'

import type { MachineEnvelope, MaskedProblem, OkEnvelope } from './decode-envelope-document.workflow.js'
import { computeExitCode } from './GetExitCode.js'
import { ComputeExitCodeCommand } from './GetExitCode.schema.js'
import type { EnvelopeMask } from './Mask.js'
import { isUntypedResult, isVisibleProblem } from './ProblemUtils.js'
import { renderJson } from './RenderJson.js'

export interface EnvelopeCommand {
  readonly result: CheckResult
  readonly ignoreRules: readonly string[]
  readonly ignoreResolutions: readonly string[]
  readonly mask: EnvelopeMask
}

export interface EnvelopeDecision {
  readonly document: MachineEnvelope
  readonly exitCode: number
}

const withoutTrace = (problem: InternalResolutionErrorProblem): MaskedProblem => {
  const { trace: _traces, ...rest } = problem
  return rest
}

const maskProblem = (problem: Problem, keepTraces: boolean): MaskedProblem => {
  if (keepTraces) return problem
  if (problem.kind === 'InternalResolutionError') return withoutTrace(problem)
  return problem
}

const countByKind = (problems: readonly MaskedProblem[]): Record<string, number> =>
  problems.reduce<Record<string, number>>((counts, problem) => {
    counts[problem.kind] = (counts[problem.kind] ?? 0) + 1
    return counts
  }, {})

const visibleProblems = (
  analysis: Analysis,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
  mask: EnvelopeMask,
): readonly MaskedProblem[] =>
  analysis.problems
    .filter((problem) => isVisibleProblem(problem, ignoredRules, ignoredResolutions))
    .map((problem) => maskProblem(problem, mask.traces))

const expandedFields = (analysis: Analysis, mask: EnvelopeMask): Partial<OkEnvelope> => {
  let fields: Partial<OkEnvelope> = {}
  if (mask.entrypoints) fields = { ...fields, entrypoints: analysis.entrypoints }
  if (mask.buildTools) fields = { ...fields, buildTools: analysis.buildTools }
  if (mask.programInfo) fields = { ...fields, programInfo: analysis.programInfo }
  return fields
}

const analysisDocument = (
  analysis: Analysis,
  problems: readonly MaskedProblem[],
  mask: EnvelopeMask,
): MachineEnvelope => ({
  status: 'ok',
  packageName: analysis.packageName,
  packageVersion: analysis.packageVersion,
  types: analysis.types,
  problems,
  problemCounts: countByKind(problems),
  ...expandedFields(analysis, mask),
})

const untypedDocument = (result: UntypedResult): MachineEnvelope => ({
  status: 'untyped',
  packageName: result.packageName,
  packageVersion: result.packageVersion,
  types: false,
})

export const decideEnvelope = (command: EnvelopeCommand): EnvelopeDecision => {
  const exitCode = computeExitCode(
    new ComputeExitCodeCommand({
      result: command.result,
      ignoreRules: [...command.ignoreRules],
      ignoreResolutions: [...command.ignoreResolutions],
    }),
  ).exitCode
  if (isUntypedResult(command.result)) {
    return { document: untypedDocument(command.result), exitCode }
  }
  return {
    document: analysisDocument(
      command.result,
      visibleProblems(command.result, command.ignoreRules, command.ignoreResolutions, command.mask),
      command.mask,
    ),
    exitCode,
  }
}

export const renderEnvelopeDocument = (document: MachineEnvelope): string =>
  renderJson(document, { pretty: false }) + '\n'
