import { valid, validRange } from 'semver'
import validatePackgeName from 'validate-npm-package-name'
import type {
  BuildTool,
  EntrypointInfo,
  EntrypointResolutionAnalysis,
  Failable,
  ParsedPackageSpec,
  Problem,
  ProblemKind,
  ResolutionKind,
  ResolutionOption,
} from './Types.js'

export const allResolutionOptions: ResolutionOption[] = ['node10', 'node16', 'bundler']
export const allResolutionKinds: ResolutionKind[] = ['node10', 'node16-cjs', 'node16-esm', 'bundler']

export function getResolutionOption(resolutionKind: ResolutionKind): ResolutionOption {
  switch (resolutionKind) {
    case 'node10':
      return 'node10'
    case 'node16-cjs':
    case 'node16-esm':
      return 'node16'
    case 'bundler':
      return 'bundler'
  }
}

export function getResolutionKinds(resolutionOption: ResolutionOption): ResolutionKind[] {
  switch (resolutionOption) {
    case 'node10':
      return ['node10']
    case 'node16':
      return ['node16-cjs', 'node16-esm']
    case 'bundler':
      return ['bundler']
  }
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

export function isNonEmptyString(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

export function visitResolutions(
  entrypoints: Record<string, EntrypointInfo>,
  visitor: (analysis: EntrypointResolutionAnalysis, info: EntrypointInfo) => unknown,
): void {
  Object.values(entrypoints).some((entrypoint) =>
    Object.values(entrypoint.resolutions).some((resolution) => visitor(resolution, entrypoint) === true)
  )
}

const appendProblemToGroup = <K extends ProblemKind>(
  groups: Partial<Record<K, (Problem & { kind: K })[]>>,
  problem: Problem & { kind: K },
): Partial<Record<K, (Problem & { kind: K })[]>> => {
  ;(groups[problem.kind] ??= []).push(problem)
  return groups
}

export function groupProblemsByKind<K extends ProblemKind>(
  problems: (Problem & { kind: K })[],
): Partial<Record<K, (Problem & { kind: K })[]>> {
  const groups: Partial<Record<K, (Problem & { kind: K })[]>> = {}
  return problems.reduce(appendProblemToGroup, groups)
}

export type { ParsedPackageSpec }

const malformedScope = (slash: number): boolean => slash === -1 || slash === 1

const scopedSeparatorStart = (input: string): number | undefined => {
  const slash = input.indexOf('/')
  if (malformedScope(slash)) return undefined
  return slash + 1
}

const separatorSearchStart = (input: string): number | undefined => {
  if (!input.startsWith('@')) return 0
  return scopedSeparatorStart(input)
}

const splitNameAndVersion = (input: string, separator: number): { name: string; version: string } => {
  if (separator === -1) return { name: input, version: '' }
  return { name: input.slice(0, separator), version: input.slice(separator + 1) }
}

const rangeOrTagKind = (version: string): ParsedPackageSpec['versionKind'] => {
  if (validRange(version) !== null) return 'range'
  return 'tag'
}

const versionedKind = (version: string): ParsedPackageSpec['versionKind'] => {
  if (valid(version) !== null) return 'exact'
  return rangeOrTagKind(version)
}

const versionKindOf = (version: string): ParsedPackageSpec['versionKind'] => {
  if (version === '') return 'none'
  return versionedKind(version)
}

const validatedName = (name: string): Failable<string> => {
  if (validatePackgeName(name).errors) return { status: 'error', error: 'Invalid package name' }
  return { status: 'success', data: name }
}

const specFor = (name: string, version: string): Failable<ParsedPackageSpec> => ({
  status: 'success',
  data: { versionKind: versionKindOf(version), name, version },
})

const followValidName = (checkedName: Failable<string>, version: string): Failable<ParsedPackageSpec> => {
  if (checkedName.status === 'error') return checkedName
  return specFor(checkedName.data, version)
}

export function parsePackageSpec(input: string): Failable<ParsedPackageSpec> {
  const searchStart = separatorSearchStart(input)
  if (searchStart === undefined) return { status: 'error', error: 'Invalid package name' }
  const { name, version } = splitNameAndVersion(input, input.indexOf('@', searchStart))
  return followValidName(validatedName(name), version)
}

const buildToolsObject = {
  '@systemfsoftware/arethetypeswrong-cli': true,
  typescript: true,
  rollup: true,
  '@rollup/plugin-typescript': true,
  '@rollup/plugin-typescript2': true,
  webpack: true,
  esbuild: true,
  'parcel-bundler': true,
  '@preconstruct/cli': true,
  vite: true,
  snowpack: true,
  microbundle: true,
  '@microsoft/api-extractor': true,
  tshy: true,
  '@rspack/cli': true,
  tsup: true,
  tsdown: true,
} satisfies Record<BuildTool, unknown>
const isBuildTool = (name: string): name is BuildTool => name in buildToolsObject
export const allBuildTools: BuildTool[] = Object.keys(buildToolsObject).filter(isBuildTool)
