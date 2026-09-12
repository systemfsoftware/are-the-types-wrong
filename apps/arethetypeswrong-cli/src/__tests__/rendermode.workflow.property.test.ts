import { it } from '@effect/vitest'
import { Match, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { decideRenderMode } from '../RenderMode.js'
import { DecideRenderModeCommand, type RenderMode } from '../RenderMode.schema.js'

type ModeFormat = DecideRenderModeCommand['format']
type ExplicitFormat = Exclude<ModeFormat, 'auto'>

interface PinnedRequest {
  readonly isTty: boolean
  readonly terminalWidth: number
  readonly format: ModeFormat
  readonly quiet: boolean
}

const modeOf = (command: DecideRenderModeCommand): RenderMode => decideRenderMode(command).mode

const requestAt = (pinned: PinnedRequest): DecideRenderModeCommand => new DecideRenderModeCommand(pinned)

const terminalWidth: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4_000 })

const autoRequest = (isTty: boolean): fc.Arbitrary<DecideRenderModeCommand> =>
  terminalWidth.map((width) => requestAt({ isTty, terminalWidth: width, format: 'auto', quiet: false }))

const anyRequest: fc.Arbitrary<DecideRenderModeCommand> = Schema.toArbitrary(DecideRenderModeCommand)(fc)

const quietRequest: fc.Arbitrary<DecideRenderModeCommand> = anyRequest.map((command) =>
  new DecideRenderModeCommand({
    isTty: command.isTty,
    terminalWidth: command.terminalWidth,
    format: command.format,
    quiet: true,
  })
)

const explicitFormat: fc.Arbitrary<ExplicitFormat> = fc.constantFrom('table', 'table-flipped', 'ascii', 'json')

const explicitRequest: fc.Arbitrary<DecideRenderModeCommand> = fc
  .tuple(fc.boolean(), terminalWidth, explicitFormat)
  .map(([isTty, width, format]) => requestAt({ isTty, terminalWidth: width, format, quiet: false }))

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
  ([command]) => modeOf(command) === expectedForFormat[command.format],
)

it.prop('∀request_QuietRequest_=quiet', [quietRequest], ([command]) => modeOf(command) === 'quiet')
