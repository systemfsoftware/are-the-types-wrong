#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-write --allow-run=git,pnpm --allow-import --allow-net=jsr.io

import { parseArgs } from '@std/cli/parse-args'
import { expandGlob } from '@std/fs/expand-glob'
import { basename } from '@std/path'
import { loadWorkspaceCycle } from './lib/cycle.ts'

let pending = 0
for await (const entry of expandGlob('.changeset/*.md')) {
  if (basename(entry.path) !== 'README.md') pending++
}

const owed = (await loadWorkspaceCycle()).length
const phase = owed > 0 ? 'publish' : pending > 0 ? 'version' : 'none'
const outputs = [`phase=${phase}`, `pending_intents=${pending}`, `this_cycle=${owed}`].join('\n')

console.error(`plan-release: pending_intents=${pending} this_cycle=${owed} -> phase=${phase}`)

const { output } = parseArgs(Deno.args, { string: ['output'] })
if (output) await Deno.writeTextFile(output, `${outputs}\n`, { append: true })
else console.log(outputs)
