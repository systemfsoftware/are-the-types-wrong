import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

export const AttwConfigSchema = S.Struct({
  ignoreRules: S.optional(S.Array(S.String)),
  ignoreResolutions: S.optional(S.Array(S.Literals(['node10', 'node16-cjs', 'node16-esm', 'bundler']))),
  format: S.optional(S.Literals(['auto', 'table', 'table-flipped', 'ascii', 'json'])),
  quiet: S.optional(S.Boolean),
  summary: S.optional(S.Boolean),
  emoji: S.optional(S.Boolean),
  color: S.optional(S.Boolean),
  entrypoints: S.optional(S.Array(S.String)),
  includeEntrypoints: S.optional(S.Array(S.String)),
  excludeEntrypoints: S.optional(S.Array(S.String)),
  entrypointsLegacy: S.optional(S.Boolean),
  fromNpm: S.optional(S.Boolean),
  pack: S.optional(S.Boolean),
  registry: S.optional(S.String),
})

export type AttwConfig = S.Schema.Type<typeof AttwConfigSchema>

const acceptedKeys =
  'ignoreRules, ignoreResolutions, format, quiet, summary, emoji, color, entrypoints, includeEntrypoints, excludeEntrypoints, entrypointsLegacy, fromNpm, pack, registry'

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const AttwConfigDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/AttwConfigDecision',
)
type AttwConfigDecisionTypeId = typeof AttwConfigDecisionTypeId

export class ConfigInvalid extends S.TaggedError<ConfigInvalid>()('ConfigInvalid', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [AttwConfigDecisionTypeId] = AttwConfigDecisionTypeId
}

export class AttwConfigTextCommand extends S.TaggedClass<AttwConfigTextCommand>()('AttwConfigTextCommand', {
  text: S.String,
  filePath: S.String,
}) {}

export class AttwConfigFileAbsentCommand extends S.TaggedClass<AttwConfigFileAbsentCommand>()(
  'AttwConfigFileAbsentCommand',
  { filePath: S.String },
) {}

export class LoadAttwConfigCommand extends S.TaggedClass<LoadAttwConfigCommand>()('LoadAttwConfigCommand', {
  request: S.Union([AttwConfigTextCommand, AttwConfigFileAbsentCommand]),
}) {}

export class AttwConfigLoaded extends S.TaggedClass<AttwConfigLoaded>()('AttwConfigLoaded', {
  config: AttwConfigSchema,
}) {
  readonly [AttwConfigDecisionTypeId] = AttwConfigDecisionTypeId
}

export class AttwConfigAbsent extends S.TaggedClass<AttwConfigAbsent>()('AttwConfigAbsent', {}) {
  readonly [AttwConfigDecisionTypeId] = AttwConfigDecisionTypeId
}

export type AttwConfigDecision = AttwConfigLoaded | AttwConfigAbsent

const configInvalid = (filePath: string, issue: string): ConfigInvalid =>
  new ConfigInvalid({
    message: `The .attw.json at ${filePath} is invalid: ${issue}`,
    recovery: `Fix the file or delete it, then rerun the same command. Accepted keys: ${acceptedKeys}.`,
  })

const decodeConfigText = (text: string, filePath: string): Result.Result<AttwConfig, ConfigInvalid> =>
  Result.mapError(
    S.decodeUnknownResult(S.fromJsonString(AttwConfigSchema))(text),
    (error) => configInvalid(filePath, oneLine(error.message)),
  )

export const loadAttwConfig = Workflow.make(
  LoadAttwConfigCommand,
  (command): Result.Result<AttwConfigDecision, ConfigInvalid> =>
    Match.value(command.request).pipe(
      Match.tag('AttwConfigFileAbsentCommand', () => Result.succeed(new AttwConfigAbsent())),
      Match.tag('AttwConfigTextCommand', ({ text, filePath }) =>
        Result.map(decodeConfigText(text, filePath), (config) =>
          new AttwConfigLoaded({ config }))),
      Match.exhaustive,
    ),
)
