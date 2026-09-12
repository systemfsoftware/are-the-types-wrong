import { it } from '@effect/vitest'
import { resolvedThroughFallback as publishedResolvedThroughFallback } from '@systemfsoftware/arethetypeswrong-published'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'

import {
  type ConditionalExportsEvent,
  ConditionalExportsScript,
} from '../../tests/__fixtures__/conditional-exports.schema.js'
import {
  detectFallbackCondition,
  DetectFallbackConditionCommand,
  ResolutionTracesCollected,
  ResolutionTracesUnavailable,
} from '../detect-fallback-condition.workflow.js'

type ConditionalExportsLines = readonly string[] | null

const lineFor = (event: ConditionalExportsEvent): string =>
  Match.value(event).pipe(
    Match.when('Entered', () => 'Entering conditional exports.'),
    Match.when('Exited', () => 'Exiting conditional exports.'),
    Match.when('Failed', () => "Failed to resolve under condition 'import'"),
    Match.when('Resolved', () => "Resolved under condition 'import'"),
    Match.exhaustive,
  )

const scriptArbitrary: fc.Arbitrary<ConditionalExportsLines> = S.toArbitrary(ConditionalExportsScript)(fc).map(
  (script) =>
    Match.value(script).pipe(
      Match.when(null, () => null),
      Match.orElse((events) => events.map(lineFor)),
    ),
)

const commandFor = (lines: ConditionalExportsLines): DetectFallbackConditionCommand =>
  Match.value(lines).pipe(
    Match.when(null, () => new DetectFallbackConditionCommand({ observation: new ResolutionTracesUnavailable() })),
    Match.orElse((resolved) =>
      new DetectFallbackConditionCommand({ observation: new ResolutionTracesCollected({ lines: [...resolved] }) })
    ),
  )

const detected = (command: DetectFallbackConditionCommand): boolean | null =>
  Result.match(detectFallbackCondition(command), {
    onFailure: () => null,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('FallbackConditionDetected', () => true),
        Match.tag('FallbackConditionAbsent', () => false),
        Match.exhaustive,
      ),
  })

function referenceScan(lines: readonly string[]): boolean {
  let i = 0
  while (i < lines.length) {
    i = lines.indexOf('Entering conditional exports.', i)
    if (i === -1) {
      return false
    }
    if (scanBlock()) {
      return true
    }
  }
  return false

  function scanBlock(): boolean {
    i++
    let seenFailure = false
    for (; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (line.startsWith("Failed to resolve under condition '")) {
        seenFailure = true
      } else if (seenFailure && line.startsWith("Resolved under condition '")) {
        return true
      } else if (line === 'Entering conditional exports.') {
        if (scanBlock()) {
          return true
        }
      } else if (line === 'Exiting conditional exports.') {
        return false
      }
    }
    return false
  }
}

it.prop('∀script_FallbackDecision_≡PublishedTrace', [scriptArbitrary], ([script]) => {
  const verdict = detected(commandFor(script))
  return Match.value(script).pipe(
    Match.when(null, () => verdict === null),
    Match.orElse((lines) => verdict === publishedResolvedThroughFallback([...lines])),
  )
})

it.prop('∀script_FallbackDecision_≡ReferenceScan', [scriptArbitrary], ([script]) => {
  const verdict = detected(commandFor(script))
  return Match.value(script).pipe(
    Match.when(null, () => verdict === null),
    Match.orElse((lines) => verdict === referenceScan(lines)),
  )
})
