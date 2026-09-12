import { Effect, Schema } from 'effect'
import { expect, it } from 'vitest'
import { AnalysisSchema } from '../src/Analysis.schema.js'
import type { Analysis } from '../src/Analysis.schema.js'

const moduleKind = {
  detectedKind: 1,
  detectedReason: 'no:type',
  reasonFileName: '/node_modules/false-cjs/dist/index.d.ts',
} as const

const analysis: Analysis = {
  packageName: 'false-cjs',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: {
    node10: {},
    node16: { moduleKinds: { '/node_modules/false-cjs/dist/index.d.ts': moduleKind } },
    bundler: {},
  },
  problems: [],
}

it('a CheckPackage-shaped analysis round-trips through the codec', async () => {
  const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(AnalysisSchema)(analysis))
  expect(decoded).toEqual(analysis)
  const encoded = await Effect.runPromise(Schema.encodeEffect(AnalysisSchema)(decoded))
  expect(encoded).toEqual(analysis)
})

it('programInfo rejects values that are not ProgramInfo', () => {
  const junk = {
    ...analysis,
    programInfo: {
      node10: {},
      node16: {
        moduleKinds: {
          '/x/index.d.ts': { detectedKind: 'bogus', detectedReason: 'no:type', reasonFileName: '/x' },
        },
      },
      bundler: {},
    },
  }
  expect(Effect.runPromise(Schema.decodeUnknownEffect(AnalysisSchema)(junk))).rejects.toThrow()
})

it('the JSON Schema for programInfo describes each resolution option instead of leaving it unconstrained', async () => {
  const doc = Schema.toJsonSchemaDocument(AnalysisSchema)
  const definitions = doc.definitions ?? {}
  const programInfoNode = doc.schema.properties['programInfo']
  expect(programInfoNode).toBeDefined()
  const options = programInfoNode.properties as Record<string, unknown>
  for (const option of ['node10', 'node16', 'bundler']) {
    let node = options[option] as { $ref?: string; type?: unknown; properties?: unknown }
    if (node !== undefined && typeof node.$ref === 'string') {
      node = definitions[node.$ref.split('/').pop() as string] as typeof node
    }
    expect(node).toBeDefined()
    expect(node.type).toBe('object')
    expect(Object.keys(node.properties ?? {}).length).toBeGreaterThan(0)
  }
})
