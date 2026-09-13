import { ComputeExitCodeCommand, ComputeExitCodeDecision } from './GetExitCode.schema.js'
import { isUntypedResult, isVisibleProblem } from './ProblemUtils.js'

const exitCodeDecision = (exitCode: number): ComputeExitCodeDecision => new ComputeExitCodeDecision({ exitCode })

const visibleProblemExitCode = (hasVisibleProblem: boolean): ComputeExitCodeDecision => {
  if (hasVisibleProblem) return exitCodeDecision(1)
  return exitCodeDecision(0)
}

export const computeExitCode = (command: ComputeExitCodeCommand): ComputeExitCodeDecision => {
  const result = command.result
  if (isUntypedResult(result)) return exitCodeDecision(0)
  return visibleProblemExitCode(
    result.problems.some((p) => isVisibleProblem(p, command.ignoreRules, command.ignoreResolutions)),
  )
}
