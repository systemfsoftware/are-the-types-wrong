import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Option, Result } from 'effect'
import * as S from 'effect/Schema'

const schemaUsageRecovery =
  '`attw schema` takes no arguments. Run `attw --help` to see the accepted commands and flags.'

const SchemaSurfaceDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/SchemaSurfaceDecision',
)
type SchemaSurfaceDecisionTypeId = typeof SchemaSurfaceDecisionTypeId

export class RenderSchemaDocumentCommand extends S.Class<RenderSchemaDocumentCommand>(
  'RenderSchemaDocumentCommand',
)({
  version: S.String,
  target: S.Option(S.String),
}) {}

export class SchemaRendered extends S.TaggedClass<SchemaRendered>()('SchemaRendered', { version: S.String }) {
  readonly [SchemaSurfaceDecisionTypeId] = SchemaSurfaceDecisionTypeId
}

export class SchemaUsageRefused extends S.TaggedClass<SchemaUsageRefused>()('SchemaUsageRefused', {
  recovery: S.String,
}) {
  readonly [SchemaSurfaceDecisionTypeId] = SchemaSurfaceDecisionTypeId
}

export class SchemaVersionUnusable extends S.TaggedError<SchemaVersionUnusable>()('SchemaVersionUnusable', {
  version: S.String,
}) {
  readonly [SchemaSurfaceDecisionTypeId] = SchemaSurfaceDecisionTypeId
}

export type SchemaSurfaceDecision = SchemaRendered | SchemaUsageRefused

const targetPresenceSchema = S.Literals(['absent', 'present'])

type TargetPresence = S.Schema.Type<typeof targetPresenceSchema>

const targetPresence = (target: Option.Option<string>): TargetPresence =>
  Match.value(Option.isSome(target)).pipe(
    Match.when(true, (): TargetPresence => 'present'),
    Match.when(false, (): TargetPresence => 'absent'),
    Match.exhaustive,
  )

const versionUsabilitySchema = S.Literals(['unusable', 'usable'])

type VersionUsability = S.Schema.Type<typeof versionUsabilitySchema>

const versionUsability = (version: string): VersionUsability =>
  Match.value(version.trim().length > 0).pipe(
    Match.when(true, (): VersionUsability => 'usable'),
    Match.when(false, (): VersionUsability => 'unusable'),
    Match.exhaustive,
  )

export const describeCliSurface = Workflow.make(
  RenderSchemaDocumentCommand,
  (command): Result.Result<SchemaSurfaceDecision, SchemaVersionUnusable> =>
    Match.value(targetPresence(command.target)).pipe(
      Match.when('present', () => Result.succeed(new SchemaUsageRefused({ recovery: schemaUsageRecovery }))),
      Match.when('absent', () =>
        Match.value(versionUsability(command.version)).pipe(
          Match.when('usable', () => Result.succeed(new SchemaRendered({ version: command.version }))),
          Match.when('unusable', () => Result.fail(new SchemaVersionUnusable({ version: command.version }))),
          Match.exhaustive,
        )),
      Match.exhaustive,
    ),
)
