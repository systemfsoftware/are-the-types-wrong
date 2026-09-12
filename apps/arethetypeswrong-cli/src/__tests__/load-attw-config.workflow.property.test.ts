import { it } from '@effect/vitest'
import { Effect, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { decodeAttwConfigText } from '../AttwConfig.js'

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

it.effect.prop('∀text_AttwConfigDecode_⊥Accepted', [notAConfigDocument], ([text]) =>
  Effect.succeed(
    Result.match(decodeAttwConfigText(text, configPath), {
      onFailure: (failure) =>
        Predicate.isTagged(failure, 'ConfigInvalid') &&
        failure.message.includes(configPath) &&
        failure.recovery.length > 0,
      onSuccess: () => false,
    }),
  ))

it.effect.prop('∀text_AttwConfigDecode_≡Literal', [validConfigDocument], ([{ text, format }]) =>
  Effect.succeed(
    Result.match(decodeAttwConfigText(text, configPath), {
      onSuccess: (config) => config.format === format,
      onFailure: () => false,
    }),
  ))
