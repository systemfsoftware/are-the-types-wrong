import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

const FallbackConditionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/FallbackConditionDecision',
)
type FallbackConditionDecisionTypeId = typeof FallbackConditionDecisionTypeId

export class ResolutionTracesUnavailable extends S.TaggedClass<ResolutionTracesUnavailable>()(
  'ResolutionTracesUnavailable',
  {},
) {}

export class ResolutionTracesCollected extends S.TaggedClass<ResolutionTracesCollected>()(
  'ResolutionTracesCollected',
  { lines: S.Array(S.String) },
) {}

export class DetectFallbackConditionCommand extends S.Class<DetectFallbackConditionCommand>(
  'DetectFallbackConditionCommand',
)({
  observation: S.Union([ResolutionTracesUnavailable, ResolutionTracesCollected]),
}) {}

export class FallbackConditionDetected extends S.TaggedClass<FallbackConditionDetected>()(
  'FallbackConditionDetected',
  {},
) {
  readonly [FallbackConditionDecisionTypeId] = FallbackConditionDecisionTypeId
}

export class FallbackConditionAbsent extends S.TaggedClass<FallbackConditionAbsent>()(
  'FallbackConditionAbsent',
  {},
) {
  readonly [FallbackConditionDecisionTypeId] = FallbackConditionDecisionTypeId
}

export class ResolutionTraceUnavailable extends S.TaggedError<ResolutionTraceUnavailable>()(
  'ResolutionTraceUnavailable',
  {},
) {
  readonly [FallbackConditionDecisionTypeId] = FallbackConditionDecisionTypeId
}

export type FallbackConditionDecision = FallbackConditionDetected | FallbackConditionAbsent
export type FallbackTraceObservation = ResolutionTracesUnavailable | ResolutionTracesCollected

const conditionalExportsEntered = 'Entering conditional exports.'
const conditionalExportsExited = 'Exiting conditional exports.'
const failedUnderCondition = "Failed to resolve under condition '"
const resolvedUnderCondition = "Resolved under condition '"

interface ConditionalExportsScan {
  readonly openBlocks: readonly boolean[]
  readonly resolvedAfterFailure: boolean
}

const initialScan: ConditionalExportsScan = { openBlocks: [], resolvedAfterFailure: false }

const markEnclosingBlockFailed = (scan: ConditionalExportsScan): ConditionalExportsScan =>
  Match.value(scan.openBlocks.length).pipe(
    Match.when(0, () => scan),
    Match.orElse(() => ({
      openBlocks: [...scan.openBlocks.slice(0, -1), true],
      resolvedAfterFailure: scan.resolvedAfterFailure,
    })),
  )

const markResolvedAfterFailure = (scan: ConditionalExportsScan): ConditionalExportsScan =>
  Match.value(scan.openBlocks[scan.openBlocks.length - 1]).pipe(
    Match.when(true, () => ({ openBlocks: scan.openBlocks, resolvedAfterFailure: true })),
    Match.orElse(() => scan),
  )

const scanStep = (scan: ConditionalExportsScan, line: string): ConditionalExportsScan =>
  Match.value(line).pipe(
    Match.when(conditionalExportsEntered, () => ({
      openBlocks: [...scan.openBlocks, false],
      resolvedAfterFailure: scan.resolvedAfterFailure,
    })),
    Match.when(conditionalExportsExited, () => ({
      openBlocks: scan.openBlocks.slice(0, -1),
      resolvedAfterFailure: scan.resolvedAfterFailure,
    })),
    Match.when((line: string) => line.startsWith(failedUnderCondition), () => markEnclosingBlockFailed(scan)),
    Match.when((line: string) => line.startsWith(resolvedUnderCondition), () => markResolvedAfterFailure(scan)),
    Match.orElse(() => scan),
  )

export const detectFallbackCondition = Workflow.make(
  DetectFallbackConditionCommand,
  (command): Result.Result<FallbackConditionDecision, ResolutionTraceUnavailable> =>
    Match.value(command.observation).pipe(
      Match.tag('ResolutionTracesUnavailable', () => Result.fail(new ResolutionTraceUnavailable())),
      Match.tag(
        'ResolutionTracesCollected',
        ({ lines }) =>
          Match.value(lines.reduce(scanStep, initialScan).resolvedAfterFailure).pipe(
            Match.when(true, () => Result.succeed(new FallbackConditionDetected())),
            Match.when(false, () => Result.succeed(new FallbackConditionAbsent())),
            Match.exhaustive,
          ),
      ),
      Match.exhaustive,
    ),
)
