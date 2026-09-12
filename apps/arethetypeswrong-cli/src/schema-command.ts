import { Effect, Match, Option, Result } from 'effect'
import * as JsonSchema from 'effect/JsonSchema'
import * as S from 'effect/Schema'
import * as Command from 'effect/unstable/cli/Command'

import { cliVersion } from './cli-version.js'
import { CliInputSchema } from './CliInput.schema.js'
import { MachineEnvelopeSchema } from './decode-envelope-document.workflow.js'
import { describeCliSurface, RenderSchemaDocumentCommand } from './describe-cli-surface.workflow.js'
import { renderJson } from './RenderJson.js'
import { Terminal } from './TerminalAdapter.js'

export interface SchemaDocument {
  readonly version: string
  readonly input: JsonSchema.Document<'draft-2020-12'>
  readonly envelope: JsonSchema.Document<'draft-2020-12'>
}

export const buildSchemaDocument = (version: string): SchemaDocument => ({
  version,
  input: S.toJsonSchemaDocument(CliInputSchema),
  envelope: S.toJsonSchemaDocument(MachineEnvelopeSchema),
})

export const renderSchemaDocument = (document: SchemaDocument): string => renderJson(document, { pretty: false }) + '\n'

export const schemaCommand = Command.make('schema', {}, () =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const decision = Result.getOrThrow(
      describeCliSurface(new RenderSchemaDocumentCommand({ version: cliVersion, target: Option.none() })),
    )
    yield* Match.value(decision).pipe(
      Match.tag('SchemaRendered', ({ version }) =>
        terminal.stdout.write(renderSchemaDocument(buildSchemaDocument(version)))),
      Match.tag('SchemaUsageRefused', ({ recovery }) =>
        terminal.stderr.write(`${recovery}\n`).pipe(Effect.andThen(Effect.sync(() => {
          process.exitCode = 1
        })))),
      Match.exhaustive,
    )
  }))
