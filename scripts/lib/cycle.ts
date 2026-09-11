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

type Released = { name: string; version: string }

export const publicPackages = async (): Promise<Released[]> => {
  const pkgs = JSON.parse(await run('pnpm', ['ls', '-r', '--json', '--depth=-1'])) as Pkg[]
  return pkgs
    .filter((pkg) => pkg.name && pkg.version && !pkg.private)
    .map((pkg) => ({ name: pkg.name as string, version: pkg.version as string }))
}

export const unpublishedWorkspace = async (): Promise<Released[]> => {
  const pkgs = await publicPackages()
  const published = await Promise.all(pkgs.map((pkg) => isPublished(pkg.name, pkg.version)))
  return pkgs.filter((_, i) => !published[i])
}

const isPublished = async (name: string, version: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`)
  if (!res.ok) return false
  const body = await res.json() as { versions?: Record<string, unknown> }
  return typeof body.versions?.[version] !== 'undefined'
}

export const loadWorkspaceCycle = async (): Promise<CycleEntry[]> => {
  const pkgs = await unpublishedWorkspace()
  return pkgs.map(({ name, version }) => ({
    name,
    version,
    tag: `${name}@v${version}`,
    changelog: join('.changeset', 'changelogs', `${name.replace('/', '!')}@${version}.md`),
  }))
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
