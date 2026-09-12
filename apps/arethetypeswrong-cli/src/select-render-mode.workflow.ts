import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Option, Result } from 'effect'
import * as S from 'effect/Schema'

import { CliFormat } from './ProblemUtils.js'

const RenderModeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/RenderModeDecision',
)
type RenderModeDecisionTypeId = typeof RenderModeDecisionTypeId

export const RequestedFormatSchema = S.Literals(CliFormat)

export type RequestedFormat = S.Schema.Type<typeof RequestedFormatSchema>

export const RenderModeSchema = S.Literals(['envelope', 'table', 'table-flipped', 'ascii', 'quiet'])

export type RenderMode = S.Schema.Type<typeof RenderModeSchema>

export class DecideRenderModeCommand extends S.TaggedClass<DecideRenderModeCommand>()('DecideRenderModeCommand', {
  isTty: S.Boolean,
  terminalWidth: S.Number,
  requestedFormat: S.String,
  quiet: S.Boolean,
}) {}

export class RenderModeSelected extends S.TaggedClass<RenderModeSelected>()('RenderModeSelected', {
  mode: RenderModeSchema,
}) {
  readonly [RenderModeDecisionTypeId] = RenderModeDecisionTypeId
}

export class QuietRenderModeSelected extends S.TaggedClass<QuietRenderModeSelected>()('QuietRenderModeSelected', {
  mode: RenderModeSchema,
}) {
  readonly [RenderModeDecisionTypeId] = RenderModeDecisionTypeId
}

export class RenderFormatUnusable extends S.TaggedError<RenderFormatUnusable>()('RenderFormatUnusable', {
  format: S.String,
}) {
  readonly [RenderModeDecisionTypeId] = RenderModeDecisionTypeId
}

export type RenderModeDecision = RenderModeSelected | QuietRenderModeSelected

const RequestedFormatClassSchema = S.Union([RequestedFormatSchema, S.Literal('unusable')])

type RequestedFormatClass = S.Schema.Type<typeof RequestedFormatClassSchema>

const requestedFormatClass = (raw: string): RequestedFormatClass =>
  Option.match(S.decodeUnknownOption(RequestedFormatSchema)(raw), {
    onNone: (): RequestedFormatClass => 'unusable',
    onSome: (format) => format,
  })

export const selectRenderMode = Workflow.make(
  DecideRenderModeCommand,
  (command): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
    Match.value(command.quiet).pipe(
      Match.when(true, (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
        Result.succeed(new QuietRenderModeSelected({ mode: 'quiet' }))),
      Match.when(false, () =>
        Match.value(requestedFormatClass(command.requestedFormat)).pipe(
          Match.when('unusable', () =>
            Result.fail(new RenderFormatUnusable({ format: command.requestedFormat }))),
          Match.when('json', (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
            Result.succeed(new RenderModeSelected({ mode: 'envelope' }))),
          Match.when('table', (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
            Result.succeed(new RenderModeSelected({ mode: 'table' }))),
          Match.when('table-flipped', (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
            Result.succeed(new RenderModeSelected({ mode: 'table-flipped' }))),
          Match.when('ascii', (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
            Result.succeed(new RenderModeSelected({ mode: 'ascii' }))),
          Match.when('auto', () =>
            Match.value(command.isTty).pipe(
              Match.when(false, (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
                Result.succeed(new RenderModeSelected({ mode: 'envelope' }))),
              Match.when(true, () =>
                Match.value(command.terminalWidth >= 100).pipe(
                  Match.when(true, (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
                    Result.succeed(new RenderModeSelected({ mode: 'table-flipped' }))),
                  Match.when(false, (): Result.Result<RenderModeDecision, RenderFormatUnusable> =>
                    Result.succeed(new RenderModeSelected({ mode: 'ascii' }))),
                  Match.exhaustive,
                )),
              Match.exhaustive,
            )),
          Match.exhaustive,
        )),
      Match.exhaustive,
    ),
)
