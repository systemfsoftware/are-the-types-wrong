import { it } from '@effect/vitest'
import { Match, Option, Result, Schema } from 'effect'
import type * as JsonSchema from 'effect/JsonSchema'
import * as fc from 'effect/testing/FastCheck'

import { analyzeFlags } from '../AttwHandler.js'
import { cliVersion } from '../cli-version.js'
import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type MachineEnvelope,
  MachineEnvelopeSchema,
} from '../decode-envelope-document.workflow.js'
import { describeCliSurface, RenderSchemaDocumentCommand } from '../describe-cli-surface.workflow.js'
import { buildSchemaDocument } from '../schema-command.js'

const schemaArray = (value: unknown): readonly JsonSchema.JsonSchema[] => {
  if (!Array.isArray(value)) return []
  return value.filter((member): member is JsonSchema.JsonSchema => typeof member === 'object' && member !== null)
}

const propertyNamesOf = (schema: JsonSchema.JsonSchema): readonly string[] => {
  const properties: unknown = schema['properties']
  if (typeof properties !== 'object' || properties === null) return []
  return Object.keys(properties)
}

const documentedPropertyNames = (document: JsonSchema.Document<'draft-2020-12'>): readonly string[] => {
  const variants = [...schemaArray(document.schema['anyOf']), ...Object.values(document.definitions)]
  const names = [
    ...propertyNamesOf(document.schema),
    ...variants.flatMap((variant) => propertyNamesOf(variant)),
  ]
  return names.filter((name, index) => names.indexOf(name) === index)
}

const wiredKeys = (value: unknown): readonly string[] => {
  if (typeof value !== 'object' || value === null) return []
  return Object.keys(value)
}

const publishedSchemaDocument = buildSchemaDocument(cliVersion)

const implementedFlags: readonly string[] = Object.keys(analyzeFlags)

const documentedFlags: readonly string[] = documentedPropertyNames(publishedSchemaDocument.input)

const documentedEnvelopeKeys: readonly string[] = documentedPropertyNames(publishedSchemaDocument.envelope)

const constantOrFallback = (values: readonly string[], fallback: string): fc.Arbitrary<string> => {
  if (values.length > 0) return fc.constantFrom(...values)
  return fc.constant(fallback)
}

const implementedFlag: fc.Arbitrary<string> = constantOrFallback(implementedFlags, '__no_implemented_flags__')

const documentedFlag: fc.Arbitrary<string> = constantOrFallback(documentedFlags, '__no_documented_flags__')

const documentedEnvelopeKey: fc.Arbitrary<string> = constantOrFallback(
  documentedEnvelopeKeys,
  '__no_documented_envelope_keys__',
)

const envelopeContract: Readonly<Record<MachineEnvelope['status'], readonly string[]>> = {
  ok: [
    'status',
    'packageName',
    'packageVersion',
    'types',
    'problems',
    'problemCounts',
    'entrypoints',
    'buildTools',
    'programInfo',
  ],
  untyped: ['status', 'packageName', 'packageVersion', 'types'],
}

const envelope: fc.Arbitrary<MachineEnvelope> = Schema.toArbitrary(MachineEnvelopeSchema)(fc)

it.prop('∀flag_ImplementedFlag_∈SchemaDocument', [implementedFlag], ([flag]) => documentedFlags.includes(flag))

it.prop(
  '∀flag_SchemaDocumentFlag_∈Implemented',
  [documentedFlag],
  ([flag]) => flag in analyzeFlags && implementedFlags.includes(flag),
)

it.prop(
  '∀key_SchemaDocumentEnvelopeKey_∈EnvelopeContract',
  [documentedEnvelopeKey],
  ([key]) => envelopeContract.ok.includes(key) || envelopeContract.untyped.includes(key),
)

it.prop(
  '∀envelope_EnvelopeWireKeys_∈SchemaDocument',
  [envelope],
  ([value]) =>
    envelopeContract[value.status].every((key) => documentedEnvelopeKeys.includes(key)) &&
    wiredKeys(value).every((key) => documentedEnvelopeKeys.includes(key)),
)

it.prop(
  '∀envelope_DecodeEnvelope_=Accepted',
  [envelope],
  ([value]) => Result.isSuccess(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value }))),
)

it.prop('∀version_SchemaDocument_=version', [fc.string()], ([version]) => {
  const document = buildSchemaDocument(version)
  return document.version === version
})

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
          Match.tag('SchemaUsageRefused', ({ recovery }) => recovery.includes('--help') && recovery.includes('schema')),
          Match.tag('SchemaRendered', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    },
  ))
