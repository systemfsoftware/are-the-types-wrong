import { expandGlob } from '@std/fs/expand-glob'
import { basename, join } from '@std/path'

const consumedIntentStems = (ledgerYaml: string): Set<string> => {
  const stems = new Set<string>()
  for (const line of ledgerYaml.split('\n')) {
    const match = /^\s+-\s+(\S+)\s*$/.exec(line)
    if (match) stems.add(match[1])
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
    const name = basename(entry.path)
    if (name === 'README.md') continue
    if (!consumed.has(name.slice(0, -'.md'.length))) pending++
  }
  return pending
}
