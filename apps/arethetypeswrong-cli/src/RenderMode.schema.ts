import * as S from 'effect/Schema'

import { CliFormat } from './ProblemUtils.js'

const RequestedFormatSchema = S.Literals(CliFormat)

export type RequestedFormat = S.Schema.Type<typeof RequestedFormatSchema>

export const RenderModeSchema = S.Literals(['envelope', 'table', 'table-flipped', 'ascii', 'quiet'])

export type RenderMode = S.Schema.Type<typeof RenderModeSchema>

export class DecideRenderModeCommand extends S.TaggedClass<DecideRenderModeCommand>()('DecideRenderModeCommand', {
  isTty: S.Boolean,
  terminalWidth: S.Number,
  format: RequestedFormatSchema,
  quiet: S.Boolean,
}) {}

export class DecideRenderModeDecision extends S.TaggedClass<DecideRenderModeDecision>()('DecideRenderModeDecision', {
  mode: RenderModeSchema,
}) {}
