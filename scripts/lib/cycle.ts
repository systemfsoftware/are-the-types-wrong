import { join } from '@std/path'
import { run } from './run.ts'

export type CycleEntry = {
  name: string
  version: string
  tag: string
  changelog: string
}

type Pkg = {
  name?: string
  version?: string
  private?: boolean
}

export const loadWorkspaceCycle = async (): Promise<CycleEntry[]> => {
  const pkgs = JSON.parse(await run('pnpm', ['ls', '-r', '--json', '--depth=-1'])) as Pkg[]
  const remote = new Set(
    (await run('git', ['ls-remote', '--tags', 'origin']))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/.*refs\/tags\//, '').replace(/\^\{\}$/, '')),
  )
  const cycle: CycleEntry[] = []
  for (const pkg of pkgs) {
    if (!pkg.name || !pkg.version || pkg.private) continue
    const tag = `${pkg.name}@v${pkg.version}`
    if (remote.has(tag)) continue
    cycle.push({
      name: pkg.name,
      version: pkg.version,
      tag,
      changelog: join('.changeset', 'changelogs', `${pkg.name.replace('/', '!')}@${pkg.version}.md`),
    })
  }
  return cycle
}

export const loadCaptured = async (path: string): Promise<CycleEntry[]> => {
  const raw: unknown = JSON.parse(await Deno.readTextFile(path))
  if (!Array.isArray(raw)) throw new Error('captured file must be a JSON array')
  return raw as CycleEntry[]
}

export const unpublishedOf = async (cycle: CycleEntry[]) => {
  const published = await Promise.all(
    cycle.map(async (entry) => {
      const res = await fetch(`https://registry.npmjs.org/${entry.name.replace('/', '%2F')}/${entry.version}`)
      return res.ok
    }),
  )
  return cycle.filter((_, i) => !published[i])
}
