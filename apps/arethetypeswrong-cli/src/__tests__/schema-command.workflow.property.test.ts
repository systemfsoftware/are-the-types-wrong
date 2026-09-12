import { it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { analyzeFlags } from '../AttwHandler.js'
import { CliInputSchema } from '../CliInput.schema.js'
import { decodeEnvelope } from '../Envelope.js'
import { type MachineEnvelope, MachineEnvelopeSchema } from '../Envelope.schema.js'
import { buildSchemaDocument, cliVersion } from '../SchemaCommand.js'

const document = buildSchemaDocument(cliVersion)
const inputText = JSON.stringify(document.input)
const envelopeText = JSON.stringify(document.envelope)

const parserFlagName: fc.Arbitrary<string> = fc.constantFrom(...Object.keys(analyzeFlags))
const schemaKey: fc.Arbitrary<string> = fc.constantFrom(...Object.keys(CliInputSchema.fields))
const envelope: fc.Arbitrary<MachineEnvelope> = Schema.toArbitrary(MachineEnvelopeSchema)(fc)

const wireKeys = (value: unknown): readonly string[] => {
  if (typeof value === 'object' && value !== null) return Object.keys(value)
  return []
}

it.prop('∀flag_InputSchema_⊇flag', [parserFlagName], ([name]) => inputText.includes(`"${name}"`))

it.prop(
  '∀flag_ParserFlags_∈SchemaKeys',
  [parserFlagName],
  ([name]) => name in CliInputSchema.fields,
)

it.prop(
  '∀key_SchemaKeys_∈ParserFlags',
  [schemaKey],
  ([name]) => name in analyzeFlags,
)

it.prop('∀envelope_DecodeEnvelope_=satisfied', [envelope], ([value]) => Result.isSuccess(decodeEnvelope(value)))

it.prop('∀envelope_EnvelopeSchema_∈status', [envelope], ([value]) => envelopeText.includes(`"${value.status}"`))

it.prop(
  '∀envelope_EnvelopeSchema_∈keys',
  [envelope],
  ([value]) => wireKeys(JSON.parse(JSON.stringify(value))).every((key) => envelopeText.includes(`"${key}"`)),
)

it.prop(
  '∀version_SchemaDocument_=version',
  [fc.string()],
  ([version]) => buildSchemaDocument(version).version === version,
)
