import { AnalysisSchema } from '@systemfsoftware/arethetypeswrong'
import type { Analysis } from '@systemfsoftware/arethetypeswrong'
import { it, layer, makeFeature } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Schema } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

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

Feature('The published analysis schema describes every field it declares').body(({ scenario }) => {
  scenario(
    'an analysis shaped like the recorded runtime value round-trips through the codec',
    Effect.promise(async () => {
      const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(AnalysisSchema)(analysis))
      expect(decoded).toEqual(analysis)
      const encoded = await Effect.runPromise(Schema.encodeEffect(AnalysisSchema)(decoded))
      expect(encoded).toEqual(analysis)
    }),
  )

  scenario(
    'module-kind details outside the declared vocabulary are refused',
    Effect.promise(async () => {
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
      await expect(Effect.runPromise(Schema.decodeUnknownEffect(AnalysisSchema)(junk))).rejects.toThrow(
        'detectedKind',
      )
    }),
  )

  scenario(
    'the emitted schema gives every resolution option a described body',
    Effect.sync(() => {
      const emitted = JSON.stringify(Schema.toJsonSchemaDocument(AnalysisSchema).schema)
      expect(emitted).toMatch(/"moduleKinds"/)
      expect(emitted).not.toMatch(/"(node10|node16|bundler)":\s*\{\}/)
    }),
  )
})
