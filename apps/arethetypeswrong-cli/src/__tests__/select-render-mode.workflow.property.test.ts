import { it } from '@effect/vitest'
import { Match, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  DecideRenderModeCommand,
  type RenderMode,
  type RequestedFormat,
  selectRenderMode,
} from '../select-render-mode.workflow.js'

type ModeFormat = RequestedFormat
type ExplicitFormat = Exclude<ModeFormat, 'auto'>

interface PinnedRequest {
  readonly isTty: boolean
  readonly terminalWidth: number
  readonly format: string
  readonly quiet: boolean
}

const modeOf = (command: DecideRenderModeCommand): RenderMode => Result.getOrThrow(selectRenderMode(command)).mode

const requestAt = (pinned: PinnedRequest): DecideRenderModeCommand =>
  new DecideRenderModeCommand({
    isTty: pinned.isTty,
    terminalWidth: pinned.terminalWidth,
    requestedFormat: pinned.format,
    quiet: pinned.quiet,
  })

const terminalWidth: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4_000 })

const autoRequest = (isTty: boolean): fc.Arbitrary<DecideRenderModeCommand> =>
  terminalWidth.map((width) => requestAt({ isTty, terminalWidth: width, format: 'auto', quiet: false }))

const anyRequest: fc.Arbitrary<DecideRenderModeCommand> = Schema.toArbitrary(DecideRenderModeCommand)(fc)

const quietRequest: fc.Arbitrary<DecideRenderModeCommand> = anyRequest.map((command) =>
  new DecideRenderModeCommand({
    isTty: command.isTty,
    terminalWidth: command.terminalWidth,
    requestedFormat: command.requestedFormat,
    quiet: true,
  })
)

const unrequestedFormat: fc.Arbitrary<string> = fc.string().map((raw) => ` ${raw}`)

const explicitFormat: fc.Arbitrary<ExplicitFormat> = fc.constantFrom('table', 'table-flipped', 'ascii', 'json')

interface ExplicitRequest {
  readonly format: ExplicitFormat
  readonly command: DecideRenderModeCommand
}

const explicitRequest: fc.Arbitrary<ExplicitRequest> = fc
  .tuple(fc.boolean(), terminalWidth, explicitFormat)
  .map(([isTty, width, format]) => ({
    format,
    command: requestAt({ isTty, terminalWidth: width, format, quiet: false }),
  }))

const expectedForFormat: Readonly<Partial<Record<ModeFormat, RenderMode>>> = {
  json: 'envelope',
  table: 'table',
  'table-flipped': 'table-flipped',
  ascii: 'ascii',
}

const ttyAutoExpected = (width: number): RenderMode =>
  Match.value(width).pipe(
    Match.when((columns: number) => columns >= 100, (): RenderMode => 'table-flipped'),
    Match.orElse((): RenderMode => 'ascii'),
  )

const boundaryWidth: fc.Arbitrary<number> = fc.constantFrom(99, 100)

const boundaryExpected: Readonly<Partial<Record<number, RenderMode>>> = {
  99: 'ascii',
  100: 'table-flipped',
}

it.prop('∀width_NonTtyAuto_=envelope', [autoRequest(false)], ([command]) => modeOf(command) === 'envelope')

it.prop(
  '∀width_TtyAuto_={≥100→table-flipped,<100→ascii}',
  [autoRequest(true)],
  ([command]) => modeOf(command) === ttyAutoExpected(command.terminalWidth),
)

it.prop(
  '∀width_TtyAutoBoundary_={99→ascii,100→table-flipped}',
  [boundaryWidth],
  ([width]) =>
    modeOf(requestAt({ isTty: true, terminalWidth: width, format: 'auto', quiet: false })) === boundaryExpected[width],
)

it.prop(
  '∀request_ExplicitFormat_=requestedFormat',
  [explicitRequest],
  ([{ format, command }]) => modeOf(command) === expectedForFormat[format],
)

it.prop('∀request_QuietRequest_=quiet', [quietRequest], ([command]) => modeOf(command) === 'quiet')

it.prop(
  '∀request_UnrequestedFormat_⊥Decided',
  [fc.boolean(), terminalWidth, unrequestedFormat],
  ([isTty, width, format]) => {
    const decided = selectRenderMode(requestAt({ isTty, terminalWidth: width, format, quiet: false }))
    return Result.isFailure(decided) && decided.failure.format === format
  },
)
