import { it } from '@effect/vitest'
import { Match, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  type AttwConfig,
  AttwConfigFileAbsentCommand,
  AttwConfigTextCommand,
  loadAttwConfig,
  LoadAttwConfigCommand,
} from '../load-attw-config.workflow.js'

type ConfigValue = string | boolean | ReadonlyArray<string> | undefined

const configPath = '/project/.attw.json'

const documentedKeys = [
  'ignoreRules',
  'ignoreResolutions',
  'format',
  'quiet',
  'summary',
  'emoji',
  'color',
  'entrypoints',
  'includeEntrypoints',
  'excludeEntrypoints',
  'entrypointsLegacy',
  'fromNpm',
  'pack',
  'registry',
] as const

const configValues = (config: AttwConfig): Readonly<Record<string, ConfigValue>> => ({
  ignoreRules: config.ignoreRules,
  ignoreResolutions: config.ignoreResolutions,
  format: config.format,
  quiet: config.quiet,
  summary: config.summary,
  emoji: config.emoji,
  color: config.color,
  entrypoints: config.entrypoints,
  includeEntrypoints: config.includeEntrypoints,
  excludeEntrypoints: config.excludeEntrypoints,
  entrypointsLegacy: config.entrypointsLegacy,
  fromNpm: config.fromNpm,
  pack: config.pack,
  registry: config.registry,
})

const sameValue = (left: ConfigValue, right: ConfigValue): boolean => {
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((one: string, index: number) => one === right[index])
  }
  return left === right
}

const holdsAuthoredValues = (
  config: AttwConfig,
  expected: Readonly<Record<string, ConfigValue>>,
): boolean => {
  const actual = configValues(config)
  return documentedKeys.every((key) => sameValue(actual[key], expected[key]))
}

interface ConfigDocumentRow {
  readonly text: string
  readonly expected: Readonly<Record<string, ConfigValue>>
}

const configDocumentTable: readonly ConfigDocumentRow[] = [
  { text: '{}', expected: {} },
  { text: '{"format":"json"}', expected: { format: 'json' } },
  { text: '{"format":"table-flipped"}', expected: { format: 'table-flipped' } },
  {
    text: '{"quiet":true,"summary":false,"emoji":false,"color":false}',
    expected: { quiet: true, summary: false, emoji: false, color: false },
  },
  {
    text: '{"ignoreRules":["false-cjs","no-resolution"]}',
    expected: { ignoreRules: ['false-cjs', 'no-resolution'] },
  },
  { text: '{"ignoreResolutions":["node16-esm"]}', expected: { ignoreResolutions: ['node16-esm'] } },
  {
    text: '{"entrypoints":["."],"includeEntrypoints":["."],"excludeEntrypoints":["dist"]}',
    expected: { entrypoints: ['.'], includeEntrypoints: ['.'], excludeEntrypoints: ['dist'] },
  },
  { text: '{"entrypointsLegacy":true}', expected: { entrypointsLegacy: true } },
  { text: '{"fromNpm":true}', expected: { fromNpm: true } },
  { text: '{"pack":true}', expected: { pack: true } },
  { text: '{"registry":"https://registry.example.com/"}', expected: { registry: 'https://registry.example.com/' } },
  {
    text: '{"format":"auto","pack":true,"fromNpm":false,"registry":"http://localhost:4873"}',
    expected: { format: 'auto', pack: true, fromNpm: false, registry: 'http://localhost:4873' },
  },
  { text: '{"quiet":true,"notAConfigKey":1}', expected: { quiet: true } },
]

const refusedConfigDocuments: readonly string[] = [
  '',
  '{',
  'null',
  '[]',
  '"ignoreRules"',
  '3',
  'true',
  '{"ignoreRules":"false-cjs"}',
  '{"ignoreRules":[1]}',
  '{"format":"bogus"}',
  '{"format":"AUTO"}',
  '{"format":null}',
  '{"quiet":"yes"}',
  '{"summary":null}',
  '{"ignoreResolutions":["node99"]}',
  '{"registry":42}',
  '{"includeEntrypoints":"."}',
  '{"entrypointsLegacy":"true"}',
  '{"fromNpm":0}',
  '{"pack":{}}',
]

const nonJsonText: fc.Arbitrary<string> = fc.string({
  unit: fc.stringMatching(/^[a-z]$/),
  minLength: 1,
  maxLength: 16,
})

const loadText = (text: string) =>
  loadAttwConfig(new LoadAttwConfigCommand({ request: new AttwConfigTextCommand({ text, filePath: configPath }) }))

const refused = (text: string): boolean =>
  Result.match(loadText(text), {
    onFailure: (failure) =>
      Predicate.isTagged(failure, 'ConfigInvalid') &&
      failure.message.includes(configPath) &&
      documentedKeys.every((key) => failure.recovery.includes(key)),
    onSuccess: () => false,
  })

it.prop(
  '∀row_AttwConfigDecode_=authoredValues',
  [fc.constantFrom(...configDocumentTable)],
  ([row]) =>
    Result.match(loadText(row.text), {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('AttwConfigLoaded', ({ config }) => holdsAuthoredValues(config, row.expected)),
          Match.tag('AttwConfigAbsent', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    }),
)

it.prop('∀text_NotAConfigDocument_⊥Load', [fc.constantFrom(...refusedConfigDocuments)], ([text]) => refused(text))

it.prop('∀text_NonJsonText_⊥Load', [nonJsonText], ([text]) => refused(text))

it.prop('∀path_ConfigFileAbsent_=Absent', [fc.string()], ([filePath]) =>
  Result.match(
    loadAttwConfig(new LoadAttwConfigCommand({ request: new AttwConfigFileAbsentCommand({ filePath }) })),
    {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('AttwConfigAbsent', () => true),
          Match.tag('AttwConfigLoaded', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    },
  ))
