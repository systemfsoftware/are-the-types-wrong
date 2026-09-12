import { Match } from 'effect'

import { DecideRenderModeCommand, DecideRenderModeDecision, type RenderMode } from './RenderMode.schema.js'

const wideTerminalColumns = 100

const humanMode = (terminalWidth: number): RenderMode =>
  Match.value(terminalWidth).pipe(
    Match.when((columns: number) => columns >= wideTerminalColumns, (): RenderMode => 'table-flipped'),
    Match.orElse((): RenderMode => 'ascii'),
  )

const personaMode = (command: DecideRenderModeCommand): RenderMode =>
  Match.value(command.isTty).pipe(
    Match.when(false, (): RenderMode => 'envelope'),
    Match.orElse(() => humanMode(command.terminalWidth)),
  )

const requestedMode = (command: DecideRenderModeCommand): RenderMode =>
  Match.value(command.format).pipe(
    Match.when('json', (): RenderMode => 'envelope'),
    Match.when('table', (): RenderMode => 'table'),
    Match.when('table-flipped', (): RenderMode => 'table-flipped'),
    Match.when('ascii', (): RenderMode => 'ascii'),
    Match.when('auto', () => personaMode(command)),
    Match.exhaustive,
  )

export const decideRenderMode = (command: DecideRenderModeCommand): DecideRenderModeDecision =>
  new DecideRenderModeDecision({
    mode: Match.value(command.quiet).pipe(
      Match.when(true, (): RenderMode => 'quiet'),
      Match.orElse(() => requestedMode(command)),
    ),
  })
