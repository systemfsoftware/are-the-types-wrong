import { it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { DecideRenderModeCommand, type RenderMode, selectRenderMode } from '../select-render-mode.workflow.js'

interface RenderPolicyRow {
  readonly isTty: boolean
  readonly terminalWidth: number
  readonly requestedFormat: string
  readonly quiet: boolean
  readonly expected: RenderMode
}

const renderPolicy: readonly RenderPolicyRow[] = [
  { isTty: true, terminalWidth: 200, requestedFormat: 'auto', quiet: true, expected: 'quiet' },
  { isTty: false, terminalWidth: 0, requestedFormat: 'json', quiet: true, expected: 'quiet' },
  { isTty: false, terminalWidth: 0, requestedFormat: 'no-such-format', quiet: true, expected: 'quiet' },
  { isTty: false, terminalWidth: 200, requestedFormat: 'table', quiet: false, expected: 'table' },
  { isTty: true, terminalWidth: 40, requestedFormat: 'table-flipped', quiet: false, expected: 'table-flipped' },
  { isTty: true, terminalWidth: 40, requestedFormat: 'ascii', quiet: false, expected: 'ascii' },
  { isTty: true, terminalWidth: 200, requestedFormat: 'json', quiet: false, expected: 'envelope' },
  { isTty: false, terminalWidth: 200, requestedFormat: 'auto', quiet: false, expected: 'envelope' },
  { isTty: false, terminalWidth: 1, requestedFormat: 'auto', quiet: false, expected: 'envelope' },
  { isTty: true, terminalWidth: 99, requestedFormat: 'auto', quiet: false, expected: 'ascii' },
  { isTty: true, terminalWidth: 100, requestedFormat: 'auto', quiet: false, expected: 'table-flipped' },
  { isTty: true, terminalWidth: 101, requestedFormat: 'auto', quiet: false, expected: 'table-flipped' },
  { isTty: true, terminalWidth: 0, requestedFormat: 'auto', quiet: false, expected: 'ascii' },
]

const requestAt = (row: RenderPolicyRow): DecideRenderModeCommand =>
  new DecideRenderModeCommand({
    isTty: row.isTty,
    terminalWidth: row.terminalWidth,
    requestedFormat: row.requestedFormat,
    quiet: row.quiet,
  })

const modeOf = (command: DecideRenderModeCommand): RenderMode => Result.getOrThrow(selectRenderMode(command)).mode

const authoredRenderMode = (command: DecideRenderModeCommand): Result.Result<RenderMode, string> => {
  if (command.quiet) return Result.succeed('quiet')
  if (command.requestedFormat === 'json') return Result.succeed('envelope')
  if (command.requestedFormat === 'table') return Result.succeed('table')
  if (command.requestedFormat === 'table-flipped') return Result.succeed('table-flipped')
  if (command.requestedFormat === 'ascii') return Result.succeed('ascii')
  if (command.requestedFormat !== 'auto') return Result.fail(command.requestedFormat)
  if (!command.isTty) return Result.succeed('envelope')
  if (command.terminalWidth >= 100) return Result.succeed('table-flipped')
  return Result.succeed('ascii')
}

it.prop(
  '∀row_RenderPolicy_=authoredMode',
  [fc.constantFrom(...renderPolicy)],
  ([row]) => modeOf(requestAt(row)) === row.expected,
)

it.prop(
  '∀command_RenderPolicyModel_=authoredMode',
  [Schema.toArbitrary(DecideRenderModeCommand)(fc)],
  ([command]) =>
    Result.match(selectRenderMode(command), {
      onSuccess: (decision) =>
        Result.match(authoredRenderMode(command), {
          onSuccess: (expected) => decision.mode === expected,
          onFailure: () => false,
        }),
      onFailure: (refusal) =>
        Result.match(authoredRenderMode(command), {
          onSuccess: () => false,
          onFailure: (format) => refusal.format === format,
        }),
    }),
)
