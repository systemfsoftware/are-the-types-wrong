#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-run=git --allow-import --allow-net=jsr.io

import { withoutAll } from '@std/collections/without-all'
import { extractYaml, test } from '@std/front-matter'
import { expandGlob } from '@std/fs/expand-glob'
import { basename } from '@std/path'
import { run } from './lib/run.ts'

const BUMP: Record<string, true> = { none: true, patch: true, minor: true, major: true }

const intentPackages = (markdown: string) => {
  if (!test(markdown)) return []
  return Object.entries(extractYaml<Record<string, unknown>>(markdown).attrs)
    .filter(([, bump]) => typeof bump === 'string' && BUMP[bump])
    .map(([name]) => name)
}

const publicPackages = async () => {
  const names: string[] = []
  for await (const file of expandGlob('packages/*/package.json')) {
    const pkg = JSON.parse(await Deno.readTextFile(file.path)) as {
      name?: string
      version?: string
      private?: boolean
    }
    if (pkg.name && pkg.version && !pkg.private) names.push(pkg.name)
  }
  return names
}

const namedIntents = async () => {
  const named: string[] = []
  for await (const file of expandGlob('.changeset/*.md')) {
    if (basename(file.path) === 'README.md') continue
    named.push(...intentPackages(await Deno.readTextFile(file.path)))
  }
  return named
}

const baseSha = Deno.args[0]
if (!baseSha) {
  console.error('usage: ./scripts/check-changeset.ts <base-sha>')
  Deno.exit(2)
}

const changed = (await run('git', ['diff', '--name-only', `${baseSha}...HEAD`])).split('\n').filter(Boolean)
const touched = changed.some((file) => file === 'packages' || file.startsWith('packages/'))
  ? await publicPackages()
  : []
const missing = withoutAll(touched, await namedIntents())

if (missing.length === 0) {
  console.log(
    touched.length === 0 ? 'no publishable-package paths in the diff' : `changeset covers: ${touched.join(', ')}`,
  )
  Deno.exit(0)
}

console.error(
  `::error::publishable package(s) changed with no changeset intent: ${
    missing.join(', ')
  }. Author one with \`pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" ${missing[0]}\`.`,
)
Deno.exit(1)
