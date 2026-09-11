#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-write --allow-run=git --allow-net=api.github.com,registry.npmjs.org --allow-env=GH_TOKEN,GITHUB_TOKEN,GITHUB_REPOSITORY --allow-import

import { parseArgs } from '@std/cli/parse-args'
import { Octokit, RequestError } from 'octokit'
import { type CycleEntry, loadCaptured, loadWorkspaceCycle } from './lib/cycle.ts'
import { run } from './lib/run.ts'

const flags = parseArgs(Deno.args, {
  boolean: ['dry-run', 'assert'],
  string: ['captured'],
})

const cycle: CycleEntry[] = flags.captured ? await loadCaptured(flags.captured) : await loadWorkspaceCycle()

if (cycle.length === 0) {
  console.log('no this-cycle releases — empty captured set')
  Deno.exit(0)
}

const pending: { entry: CycleEntry; body: string }[] = []
for (const entry of cycle) {
  const { name, version, changelog } = entry
  let raw: string | null = null
  try {
    raw = await Deno.readTextFile(changelog)
  } catch {
    raw = null
  }
  if (raw === null || raw.trim().length === 0) {
    const state = raw === null ? 'Missing' : 'Empty'
    console.error(
      `::error::${state} changelog for ${name}@${version}: expected ${changelog} — body must be the pnpm-generated changelog.`,
    )
    Deno.exit(1)
  }
  pending.push({ entry, body: raw.trim() })
}

if (flags.assert) {
  console.log(`assert ok: ${cycle.length} changelog(s) present`)
  Deno.exit(0)
}

if (flags['dry-run']) {
  for (const { entry } of pending) {
    console.log(`would create release ${entry.tag} from ${entry.changelog}`)
  }
  console.log(`dry run: ${pending.length} release(s)`)
  Deno.exit(0)
}

const slug = Deno.env.get('GITHUB_REPOSITORY') ?? (await run('git', ['remote', 'get-url', 'origin']))
  .trim()
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/^https?:\/\/github\.com\//, '')
  .replace(/\.git$/, '')
const [owner, repo] = slug.split('/')
const octokit = new Octokit({ auth: Deno.env.get('GITHUB_TOKEN') ?? Deno.env.get('GH_TOKEN') ?? undefined })

const created: { tag: string; id: number }[] = []
let loopError: Error | null = null
for (const { entry, body } of pending) {
  const { tag } = entry
  let exists = false
  try {
    await octokit.rest.repos.getReleaseByTag({ owner, repo, tag })
    exists = true
  } catch (error) {
    if (!(error instanceof RequestError) || error.status !== 404) {
      loopError = new Error(
        `looking up ${tag} in ${owner}/${repo} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      break
    }
  }
  if (exists) {
    console.log(`skip ${tag} — release exists`)
    continue
  }
  try {
    const res = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      body,
      prerelease: false,
      make_latest: 'false',
    })
    console.log(`created release ${tag}`)
    created.push({ tag, id: res.data.id })
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) {
      console.log(`skip ${tag} — release exists`)
      continue
    }
    loopError = new Error(
      `creating release ${tag} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    break
  }
}

if (created.length > 0 && !loopError) {
  try {
    await octokit.rest.repos.updateRelease({ owner, repo, release_id: created[0].id, make_latest: 'true' })
    console.log(`reconciled make_latest true on ${created[0].tag}`)
  } catch (error) {
    const msg = `reconciling make_latest for ${created[0].tag} failed: ${
      error instanceof Error ? error.message : String(error)
    }`
    console.error(`::error::${msg}`)
    loopError = new Error(msg)
  }
}

if (loopError) {
  console.error(`::error::${loopError.message}`)
  Deno.exit(1)
}
console.log(`created ${created.length} release(s), skipped ${cycle.length - created.length}`)
