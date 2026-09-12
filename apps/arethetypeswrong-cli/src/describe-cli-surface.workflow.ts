import { Effect } from 'effect'
import * as JsonSchema from 'effect/JsonSchema'
import * as S from 'effect/Schema'
import * as Command from 'effect/unstable/cli/Command'

import manifest from '../package.json'
import { CliInputSchema } from './CliInput.schema.js'
import { MachineEnvelopeSchema } from './Envelope.schema.js'
import { renderJson } from './RenderJson.js'
import { Terminal } from './TerminalAdapter.js'

/**
 * The version the bundler inlines from the manifest (`tsdown` replaces the
 * import), because the npm package ships no `package.json` for a runtime read.
 */
export const cliVersion: string = manifest.version

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
    yield* terminal.stdout.write(renderSchemaDocument(buildSchemaDocument(cliVersion)))
  }))
