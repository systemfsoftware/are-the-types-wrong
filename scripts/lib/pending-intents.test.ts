import { assertEquals } from '@std/assert/equals'
import { join } from '@std/path'
import { countPendingIntents } from './pending-intents.ts'

Deno.test('ledgered intent files are not pending', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(join(dir, 'README.md'), '# Changesets\n')
    await Deno.writeTextFile(join(dir, 'force-34643654002-patch.md'), '---\n"pkg": patch\n---\n\nsummary\n')
    await Deno.writeTextFile(join(dir, 'twenty-vans-prove.md'), '---\n"pkg": patch\n---\n\nsummary\n')
    await Deno.writeTextFile(join(dir, 'fresh-unconsumed.md'), '---\n"pkg": patch\n---\n\nsummary\n')
    await Deno.writeTextFile(
      join(dir, 'ledger.yaml'),
      `"pkg@1.0.1":\n  dir: packages/pkg\n  intents:\n    - force-34643654002-patch\n    - twenty-vans-prove\n`,
    )
    assertEquals(await countPendingIntents(dir), 1)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('all intents are pending when the ledger is absent', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(join(dir, 'fresh-unconsumed.md'), '---\n"pkg": patch\n---\n\nsummary\n')
    assertEquals(await countPendingIntents(dir), 1)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('README is never pending', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(join(dir, 'README.md'), '# Changesets\n')
    await Deno.writeTextFile(join(dir, 'ledger.yaml'), '{}\n')
    assertEquals(await countPendingIntents(dir), 0)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('YAML-quoted intent stems still count as consumed', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(join(dir, 'force-quoted.md'), '---\n"pkg": patch\n---\n\nsummary\n')
    await Deno.writeTextFile(
      join(dir, 'ledger.yaml'),
      `"pkg@1.0.1":\n  intents:\n    - "force-quoted"\n`,
    )
    assertEquals(await countPendingIntents(dir), 0)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
