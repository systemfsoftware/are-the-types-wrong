#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-write --allow-run=git,pnpm --allow-net=jsr.io,registry.npmjs.org --allow-import

import { parseArgs } from '@std/cli/parse-args'
import { loadCaptured, loadWorkspaceCycle, unpublishedOf } from './lib/cycle.ts'
import { run } from './lib/run.ts'

const flags = parseArgs(Deno.args, {
  boolean: ['dry-run', 'json', 'unpublished', 'publish'],
  string: ['output', 'captured'],
})

const loaded = flags.captured ? await loadCaptured(flags.captured) : await loadWorkspaceCycle()
const cycle = flags.unpublished ? await unpublishedOf(loaded) : loaded

if (flags.publish) {
  if (cycle.length === 0) {
    console.log('every captured version is already on npm — tagging only')
    Deno.exit(0)
  }
  console.log(`publishing ${cycle.map((entry) => `${entry.name}@${entry.version}`).join(', ')}`)
  const published = await new Deno.Command('pnpm', {
    args: ['publish', '-r', '--provenance', '--access', 'public', '--no-git-checks'],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (!published.success) {
    console.error(
      `::error::pnpm publish -r --provenance --access public --no-git-checks failed (exit ${published.code})`,
    )
    Deno.exit(published.code || 1)
  }
  Deno.exit(0)
}

if (flags.output) {
  await Deno.writeTextFile(flags.output, JSON.stringify(cycle, null, 2))
  console.error(`wrote ${cycle.length} captured package(s) to ${flags.output}`)
}

if (flags.json) {
  console.log(JSON.stringify(cycle))
  Deno.exit(0)
}

if (flags['dry-run'] || flags.output) {
  for (const { tag } of cycle) console.log(`would tag ${tag}`)
  console.log(`dry run: ${cycle.length} tag(s)`)
  Deno.exit(0)
}

if (cycle.length === 0) {
  console.log('no new tags to push')
  Deno.exit(0)
}

const made: string[] = []
for (const { tag } of cycle) {
  await run('git', ['tag', tag])
  made.push(tag)
}
await run('git', ['push', 'origin', ...made.map((t) => `refs/tags/${t}`)])
console.log(`pushed ${made.length} tag(s): ${made.join(', ')}`)
