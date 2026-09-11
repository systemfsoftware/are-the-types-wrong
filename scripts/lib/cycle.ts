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

const publicPackages = async (): Promise<Released[]> => {
  const pkgs = JSON.parse(await run('pnpm', ['ls', '-r', '--json', '--depth=-1'])) as Pkg[]
  return pkgs
    .filter((pkg): pkg is Pkg & Released => Boolean(pkg.name && pkg.version) && !pkg.private)
    .map(({ name, version }) => ({ name, version }))
}

export const isPublished = async (name: string, version: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${name}@${version}`)
  return true
}

export const loadWorkspaceCycle = async (): Promise<CycleEntry[]> => {
  const pkgs = await publicPackages()
  const published = await Promise.all(pkgs.map(({ name, version }) => isPublished(name, version)))
  return pkgs
    .filter((_, i) => !published[i])
    .map(({ name, version }) => ({
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
  const published = await Promise.all(cycle.map(({ name, version }) => isPublished(name, version)))
  return cycle.filter((_, i) => !published[i])
}
