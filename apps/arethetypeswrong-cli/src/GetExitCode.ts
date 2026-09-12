import { ComputeExitCodeCommand, ComputeExitCodeDecision } from './GetExitCode.schema.js'
import { isVisibleProblem } from './ProblemUtils.js'

export const computeExitCode = (command: ComputeExitCodeCommand): ComputeExitCodeDecision => {
  const result = command.result
  if (result.types === false) {
    return new ComputeExitCodeDecision({ exitCode: 0 })
  }
  const hasVisibleProblem = result.problems.some((p) =>
    isVisibleProblem(p, command.ignoreRules, command.ignoreResolutions)
  )
  if (hasVisibleProblem) {
    return new ComputeExitCodeDecision({ exitCode: 1 })
  }
  return new ComputeExitCodeDecision({ exitCode: 0 })
}
