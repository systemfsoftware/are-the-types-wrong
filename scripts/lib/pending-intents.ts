import { expandGlob } from '@std/fs/expand-glob'
import { basename, join } from '@std/path'
import { parse } from '@std/yaml'

const consumedIntentStems = (ledgerYaml: string): Set<string> => {
  const parsed = parse(ledgerYaml)
  const stems = new Set<string>()
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return stems
  const ledger = parsed as Record<string, unknown>
  for (const value of Object.values(ledger)) {
    let intents: unknown
    if (Array.isArray(value)) intents = value
    else if (value !== null && typeof value === 'object' && 'intents' in value) intents = value.intents
    else continue
    if (!Array.isArray(intents)) continue
    for (const intent of intents) {
      if (typeof intent === 'string') stems.add(intent)
    }
  }
  return stems
}

export const countPendingIntents = async (changesetDir: string): Promise<number> => {
  let consumed = new Set<string>()
  try {
    consumed = consumedIntentStems(await Deno.readTextFile(join(changesetDir, 'ledger.yaml')))
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  let pending = 0
  for await (const entry of expandGlob(join(changesetDir, '*.md'))) {
    const stem = basename(entry.path, '.md')
    if (stem !== 'README' && !consumed.has(stem)) pending++
  }
  return pending
}
