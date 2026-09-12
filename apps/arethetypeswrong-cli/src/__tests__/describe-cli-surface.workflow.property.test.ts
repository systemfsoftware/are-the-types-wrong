import { it } from '@effect/vitest'
import { Match, Option, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { analyzeFlags } from '../AttwHandler.js'
import { cliVersion } from '../cli-version.js'
import { CliInputSchema } from '../CliInput.schema.js'
import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type MachineEnvelope,
  MachineEnvelopeSchema,
} from '../decode-envelope-document.workflow.js'
import { describeCliSurface, RenderSchemaDocumentCommand } from '../describe-cli-surface.workflow.js'
import { buildSchemaDocument } from '../schema-command.js'

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

it.prop(
  '∀envelope_DecodeEnvelope_=satisfied',
  [envelope],
  ([value]) => Result.isSuccess(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value }))),
)

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

it.prop('∀version_SchemaSurface_=rendered∨unusable', [fc.string()], ([version]) =>
  Result.match(
    describeCliSurface(new RenderSchemaDocumentCommand({ version, target: Option.none() })),
    {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('SchemaRendered', ({ version: rendered }) => version.trim().length > 0 && rendered === version),
          Match.tag('SchemaUsageRefused', () => false),
          Match.exhaustive,
        ),
      onFailure: (refusal) => version.trim().length === 0 && refusal.version === version,
    },
  ))

it.prop('∀target_SchemaSurface_=UsageRefused', [fc.string()], ([target]) =>
  Result.match(
    describeCliSurface(new RenderSchemaDocumentCommand({ version: cliVersion, target: Option.some(target) })),
    {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('SchemaUsageRefused', ({ recovery }) => recovery.length > 0),
          Match.tag('SchemaRendered', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    },
  ))
