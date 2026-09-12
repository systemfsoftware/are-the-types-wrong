import { it } from '@effect/vitest'
import { Match, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  AttwConfigFileAbsentCommand,
  AttwConfigTextCommand,
  loadAttwConfig,
  LoadAttwConfigCommand,
} from '../load-attw-config.workflow.js'

const configPath = '/project/.attw.json'

const invalidJsonText: fc.Arbitrary<string> = fc.string({
  unit: fc.stringMatching(/^[a-z]$/),
  minLength: 1,
  maxLength: 16,
})

const notAConfigDocument: fc.Arbitrary<string> = fc.oneof(
  invalidJsonText,
  fc.constantFrom(
    '',
    '{',
    'null',
    '[]',
    '"ignoreRules"',
    '{"ignoreRules": 3}',
    '{"format": "bogus"}',
    '{"quiet": "yes"}',
    '{"ignoreResolutions": ["node99"]}',
  ),
)

const validConfigDocument = fc.constantFrom(
  { text: '{}', format: undefined },
  { text: '{"format": "json"}', format: 'json' },
  { text: '{"format": "table"}', format: 'table' },
  { text: '{"format": "ascii", "quiet": true}', format: 'ascii' },
  { text: '{"ignoreRules": ["false-cjs"]}', format: undefined },
)

it.prop(
  '∀text_AttwConfigDecode_⊥Accepted',
  [notAConfigDocument],
  ([text]) =>
    Result.match(
      loadAttwConfig(new LoadAttwConfigCommand({ request: new AttwConfigTextCommand({ text, filePath: configPath }) })),
      {
        onFailure: (failure) =>
          Predicate.isTagged(failure, 'ConfigInvalid') &&
          failure.message.includes(configPath) &&
          failure.recovery.length > 0,
        onSuccess: () => false,
      },
    ),
)

it.prop(
  '∀text_AttwConfigDecode_≡Literal',
  [validConfigDocument],
  ([{ text, format }]) =>
    Result.match(
      loadAttwConfig(new LoadAttwConfigCommand({ request: new AttwConfigTextCommand({ text, filePath: configPath }) })),
      {
        onSuccess: (decision) =>
          Match.value(decision).pipe(
            Match.tag('AttwConfigLoaded', ({ config }) => config.format === format),
            Match.tag('AttwConfigAbsent', () => false),
            Match.exhaustive,
          ),
        onFailure: () => false,
      },
    ),
)

it.prop(
  '∀filePath_AttwConfigAbsent_=Absent',
  [fc.string()],
  ([filePath]) =>
    Result.match(
      loadAttwConfig(new LoadAttwConfigCommand({ request: new AttwConfigFileAbsentCommand({ filePath }) })),
      {
        onSuccess: (decision) => Predicate.isTagged(decision, 'AttwConfigAbsent'),
        onFailure: () => false,
      },
    ),
)
