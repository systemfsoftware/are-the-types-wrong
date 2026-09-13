import { it } from '@effect/vitest'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'

import { ConditionalExportsScript } from '../../tests/__fixtures__/conditional-exports.schema.js'
import {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
} from '../detect-fallback-condition.workflow.js'

type ConditionalExportsLines = readonly string[] | null

const ENTERED = 'Entering conditional exports.'
const EXITED = 'Exiting conditional exports.'
const FAILED_PREFIX = "Failed to resolve under condition '"
const RESOLVED_PREFIX = "Resolved under condition '"
const FAILED_UNDER_REQUIRE = `${FAILED_PREFIX}require'`
const RESOLVED_UNDER_IMPORT = `${RESOLVED_PREFIX}import'`

const scriptArbitrary: fc.Arbitrary<ConditionalExportsLines> = S.toArbitrary(ConditionalExportsScript)(fc).map(
  (script) =>
    script?.map((event) =>
      Match.value(event).pipe(
        Match.when('Entered', () => ENTERED),
        Match.when('Exited', () => EXITED),
        Match.when('Failed', () => FAILED_UNDER_REQUIRE),
        Match.when('Resolved', () => RESOLVED_UNDER_IMPORT),
        Match.exhaustive,
      )
    ) ?? null,
)

const observedVerdict = (lines: ConditionalExportsLines): boolean | null =>
  Result.match(
    detectFallbackCondition(
      new DetectFallbackConditionCommand({
        observation: Match.value(lines).pipe(
          Match.when(null, () => new ResolutionTracesUnavailable()),
          Match.orElse((resolved) => new ResolutionTracesCollected({ lines: [...resolved] })),
        ),
      }),
    ),
    {
      onFailure: () => null,
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('FallbackConditionDetected', () => true),
          Match.tag('FallbackConditionAbsent', () => false),
          Match.exhaustive,
        ),
    },
  )

interface BlockScan {
  readonly detected: boolean
  readonly next: number
}

function scanBlock(lines: readonly string[], from: number): BlockScan {
  let failed = false
  let cursor = from
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (line === ENTERED) {
      const nested = scanBlock(lines, cursor + 1)
      if (nested.detected) {
        return nested
      }
      cursor = nested.next
    } else if (line === EXITED) {
      return { detected: false, next: cursor + 1 }
    } else if (line.startsWith(FAILED_PREFIX)) {
      failed = true
      cursor += 1
    } else if (line.startsWith(RESOLVED_PREFIX) && failed) {
      return { detected: true, next: cursor + 1 }
    } else {
      cursor += 1
    }
  }
  return { detected: false, next: cursor }
}

function referenceScan(lines: readonly string[]): boolean {
  let cursor = 0
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (line === ENTERED) {
      const block = scanBlock(lines, cursor + 1)
      if (block.detected) {
        return true
      }
      cursor = block.next
    } else {
      cursor += 1
    }
  }
  return false
}

const INTENDED_FALLBACK_VERDICTS: readonly (readonly [ConditionalExportsLines, boolean | null])[] = [
  [null, null],
  [[], false],
  [[ENTERED, EXITED], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, EXITED], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, RESOLVED_UNDER_IMPORT, EXITED], true],
  [[ENTERED, RESOLVED_UNDER_IMPORT, FAILED_UNDER_REQUIRE, EXITED], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, ENTERED, RESOLVED_UNDER_IMPORT, EXITED, EXITED], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, ENTERED, FAILED_UNDER_REQUIRE, RESOLVED_UNDER_IMPORT, EXITED, EXITED], true],
  [[ENTERED, FAILED_UNDER_REQUIRE, EXITED, RESOLVED_UNDER_IMPORT], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, ENTERED, EXITED, RESOLVED_UNDER_IMPORT, EXITED], true],
  [[FAILED_UNDER_REQUIRE, RESOLVED_UNDER_IMPORT], false],
  [[ENTERED, FAILED_UNDER_REQUIRE, RESOLVED_UNDER_IMPORT], true],
  [[ENTERED, EXITED, ENTERED, FAILED_UNDER_REQUIRE, RESOLVED_UNDER_IMPORT, EXITED], true],
  [[ENTERED, ENTERED, FAILED_UNDER_REQUIRE, EXITED, RESOLVED_UNDER_IMPORT, EXITED], false],
]

it.prop(
  '∀script_FallbackCondition_≡IntendedVerdictTable',
  [fc.constantFrom(...INTENDED_FALLBACK_VERDICTS)],
  ([row]) => {
    const [script, intended] = row
    return observedVerdict(script) === intended
  },
)

it.prop('∀script_FallbackCondition_≡ReferenceScan', [scriptArbitrary], ([script]) => {
  const verdict = observedVerdict(script)
  return Match.value(script).pipe(
    Match.when(null, () => verdict === null),
    Match.orElse((lines) => verdict === referenceScan(lines)),
  )
})
