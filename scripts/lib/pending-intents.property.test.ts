import { assertEquals } from '@std/assert/equals'
import { join } from '@std/path'

import { countPendingIntents } from './pending-intents.ts'

const readmeStem = 'README'
const intentStems = ['alpha', 'beta', 'gamma'] as const

type IntentStem = typeof intentStems[number]

const ledgerShapes = [
  'absent',
  'emptyObject',
  'topSequence',
  'scalarValue',
  'arrayIntents',
  'nestedIntents',
  'quotedIntents',
  'numericIntents',
  'mixedIntents',
] as const

type LedgerShape = typeof ledgerShapes[number]

interface LedgerState {
  readonly stems: readonly string[]
  readonly shape: LedgerShape
  readonly consumed: readonly IntentStem[]
}

const powerset = <T>(items: readonly T[]): readonly (readonly T[])[] => {
  let subsets: readonly (readonly T[])[] = [[]]
  for (const item of items) {
    subsets = [...subsets, ...subsets.map((subset) => [...subset, item])]
  }
  return subsets
}

const fileStemSets = powerset([readmeStem, ...intentStems])
const consumedStemSets = powerset(intentStems)

const intentList = (consumed: readonly IntentStem[]): string => consumed.map((stem) => `"${stem}"`).join(', ')

const consumedLines = (consumed: readonly IntentStem[]): string => consumed.map((stem) => `    - "${stem}"\n`).join('')

const ledgerYaml = (state: LedgerState): string | undefined => {
  const consumed = state.consumed
  const shape = state.shape
  if (shape === 'absent') return undefined
  if (shape === 'emptyObject') return '{}\n'
  if (shape === 'topSequence') return consumed.map((stem) => `- ${stem}\n`).join('')
  if (shape === 'scalarValue') return '"pkg@1.0.0": 3\n'
  if (shape === 'arrayIntents') return `"pkg@1.0.0": [${intentList(consumed)}]\n`
  if (shape === 'nestedIntents') {
    return `"pkg@1.0.0":\n  dir: packages/pkg\n  intents: [${intentList(consumed)}]\n`
  }
  if (shape === 'quotedIntents') return `"pkg@1.0.0":\n  intents:\n${consumedLines(consumed)}`
  if (shape === 'numericIntents') return '"pkg@1.0.0":\n  intents:\n    - 1\n    - 2\n'
  return `"pkg@1.0.0":\n  intents:\n${consumedLines(consumed)}    - 3\n`
}

const recordsConsumedIntents = (shape: LedgerShape): boolean =>
  shape === 'arrayIntents' || shape === 'nestedIntents' || shape === 'quotedIntents' || shape === 'mixedIntents'

const authoredConsumed = (state: LedgerState): readonly string[] =>
  recordsConsumedIntents(state.shape) ? state.consumed : []

const authoredPending = (state: LedgerState): number =>
  state.stems.filter((stem) => stem !== readmeStem && !authoredConsumed(state).includes(stem)).length

const describeState = (state: LedgerState): string => JSON.stringify(state)

Deno.test('a recorded release excuses exactly the intents it consumed, and no other changeset', async () => {
  const root = await Deno.makeTempDir()
  try {
    let index = 0
    for (const stems of fileStemSets) {
      for (const consumed of consumedStemSets) {
        for (const shape of ledgerShapes) {
          const state: LedgerState = { stems, shape, consumed }
          const dir = join(root, `state-${index}`)
          index++
          await Deno.mkdir(dir)
          for (const stem of stems) {
            await Deno.writeTextFile(join(dir, `${stem}.md`), '---\n"pkg": patch\n---\n\nsummary\n')
          }
          const ledger = ledgerYaml(state)
          if (ledger !== undefined) await Deno.writeTextFile(join(dir, 'ledger.yaml'), ledger)
          assertEquals(await countPendingIntents(dir), authoredPending(state), describeState(state))
        }
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('an unreadable ledger surfaces the parse failure instead of counting silently', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(join(dir, `${intentStems[0]}.md`), '---\n"pkg": patch\n---\n\nsummary\n')
    await Deno.writeTextFile(join(dir, 'ledger.yaml'), '"pkg@1.0.0": [unclosed\n')
    let parseFailed = false
    try {
      await countPendingIntents(dir)
    } catch {
      parseFailed = true
    }
    assertEquals(parseFailed, true)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
