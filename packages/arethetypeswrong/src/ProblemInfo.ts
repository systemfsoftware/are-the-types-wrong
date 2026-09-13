import type { Analysis } from './Analysis.schema.js'
import { type Problem, type ProblemKind, type ResolutionKind, type ResolutionOption } from './Problem.schema.js'
import type { EntrypointInfo } from './Resolution.schema.js'
import { getResolutionKinds } from './ResolutionKind.js'

export interface ProblemKindInfo {
  readonly title: string
  readonly emoji: string
  readonly shortDescription: string
  readonly description: string
  readonly details?: string
  readonly docsUrl: string
}

export const problemKindInfo: Record<ProblemKind, ProblemKindInfo> = {
  NoResolution: {
    emoji: '💀',
    title: 'Resolution failed',
    shortDescription: 'Resolution failed',
    description: 'Import failed to resolve to type declarations or JavaScript files.',
    docsUrl: 'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/NoResolution.md',
  },
  UntypedResolution: {
    emoji: '❌',
    title: 'Could not find types',
    shortDescription: 'No types',
    description: 'Import resolved to JavaScript files, but no type declarations were found.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/UntypedResolution.md',
  },
  FalseCJS: {
    emoji: '🎭',
    title: 'Types are CJS, but implementation is ESM',
    shortDescription: 'Masquerading as CJS',
    description: 'Import resolved to a CommonJS type declaration file, but an ESM JavaScript file.',
    docsUrl: 'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseCJS.md',
  },
  FalseESM: {
    emoji: '👺',
    title: 'Types are ESM, but implementation is CJS',
    shortDescription: 'Masquerading as ESM',
    description: 'Import resolved to an ESM type declaration file, but a CommonJS JavaScript file.',
    docsUrl: 'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseESM.md',
  },
  NamedExports: {
    emoji: '🕵️',
    title: 'Named exports cannot be detected by Node.js',
    shortDescription: 'Named exports',
    description:
      'TypeScript allows ESM named imports of the properties of this CommonJS module, but they will crash at runtime because they don’t exist or can’t be statically detected by Node.js in the JavaScript file.',
    details: 'the list of exports TypeScript can see but Node.js cannot',
    docsUrl: 'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/NamedExports.md',
  },
  CJSResolvesToESM: {
    emoji: '⚠️',
    title: 'Entrypoint is ESM-only',
    shortDescription: 'ESM (dynamic import only)',
    description:
      'A `require` call resolved to an ESM JavaScript file, which is an error in Node and some bundlers. CommonJS consumers will need to use a dynamic import.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/CJSResolvesToESM.md',
  },
  FallbackCondition: {
    emoji: '🐛',
    title: 'Resolved through fallback condition',
    shortDescription: 'Used fallback condition',
    description:
      'Import resolved to types through a conditional package.json export, but only after failing to resolve through an earlier condition. This behavior is a [TypeScript bug](https://github.com/microsoft/TypeScript/issues/50762). It may misrepresent the runtime behavior of this import and should not be relied upon.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FallbackCondition.md',
  },
  CJSOnlyExportsDefault: {
    emoji: '🤨',
    title: 'CJS module uses default export',
    shortDescription: 'CJS default export',
    description:
      'CommonJS module simulates a default export with `exports.default` and `exports.__esModule`, but does not also set `module.exports` for compatibility with Node. Node, and [some bundlers under certain conditions](https://andrewbranch.github.io/interop-test/#synthesizing-default-exports-for-cjs-modules), do not respect the `__esModule` marker, so accessing the intended default export will require a `.default` property access on the default import.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/CJSOnlyExportsDefault.md',
  },
  FalseExportDefault: {
    emoji: '❗️',
    title: 'Types incorrectly use default export',
    shortDescription: 'Incorrect default export',
    description:
      'The resolved types use `export default` where the JavaScript file appears to use `module.exports =`. This will cause TypeScript under the `node16` module mode to think an extra `.default` property access is required, but that will likely fail at runtime. These types should use `export =` instead of `export default`.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseExportDefault.md',
  },
  MissingExportEquals: {
    emoji: '❓',
    title: 'Types are missing an `export =`',
    shortDescription: 'Missing `export =`',
    description:
      'The JavaScript appears to set both `module.exports` and `module.exports.default` for improved compatibility, but the types only reflect the latter (by using `export default`). This will cause TypeScript under the `node16` module mode to think an extra `.default` property access is required, which will work at runtime but is not necessary. These types should `export =` an object with a `default` property instead of using `export default`.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/MissingExportEquals.md',
  },
  UnexpectedModuleSyntax: {
    emoji: '🚭',
    title: 'Syntax is incompatible with detected module kind',
    shortDescription: 'Unexpected module syntax',
    description:
      'Syntax detected in the module is incompatible with the module kind according to the package.json or file extension. This is an error in Node and may cause problems in some bundlers.',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/UnexpectedModuleSyntax.md',
  },
  InternalResolutionError: {
    emoji: '🥴',
    title: 'Internal resolution error',
    shortDescription: 'Internal resolution error',
    description:
      'Import found in a type declaration file failed to resolve. Either this indicates that runtime resolution errors will occur, or (more likely) the types misrepresent the contents of the JavaScript files.',
    details: 'the imports that failed to resolve',
    docsUrl:
      'https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/InternalResolutionError.md',
  },
}

const isProblemKind = (kind: string): kind is ProblemKind => kind in problemKindInfo
export const allProblemKinds: readonly ProblemKind[] = Object.keys(problemKindInfo).filter(isProblemKind)

export interface ProblemFilter {
  readonly kind?: readonly ProblemKind[]
  readonly entrypoint?: string
  readonly resolutionKind?: ResolutionKind
  readonly resolutionOption?: ResolutionOption
}

const foundProblemIndex = (index: number): number => {
  if (index === -1) {
    throw new Error(`Could not find problem in analysis`)
  }
  return index
}

const indexBySerializedProblem = (analysis: Analysis, problem: Problem): number => {
  const serialized = JSON.stringify(problem)
  return foundProblemIndex(analysis.problems.findIndex((candidate) => JSON.stringify(candidate) === serialized))
}

const getProblemIndex = (analysis: Analysis, problem: Problem): number => {
  const index = analysis.problems.indexOf(problem)
  if (index !== -1) return index
  return indexBySerializedProblem(analysis, problem)
}

const resolutionVisibleProblems = (
  entrypoint: EntrypointInfo,
  resolutionKind: ResolutionKind,
): readonly number[] | undefined => entrypoint.resolutions[resolutionKind]?.visibleProblems

const includesProblemIndex = (visible: readonly number[] | undefined, index: number): boolean =>
  visible !== undefined && visible.includes(index)

const problemAffectsResolutionKind = (
  problem: Problem,
  resolutionKind: ResolutionKind,
  analysis: Analysis,
): boolean => {
  const index = getProblemIndex(analysis, problem)
  return Object.values(analysis.entrypoints).some((entrypoint) =>
    includesProblemIndex(resolutionVisibleProblems(entrypoint, resolutionKind), index)
  )
}

const problemAffectsEntrypoint = (
  problem: Problem,
  entrypoint: string,
  analysis: Analysis,
): boolean => {
  const index = getProblemIndex(analysis, problem)
  if (!Object.hasOwn(analysis.entrypoints, entrypoint)) return false
  return Object.values(analysis.entrypoints[entrypoint].resolutions).some((resolution) =>
    includesProblemIndex(resolution.visibleProblems, index)
  )
}

const entrypointInfoAt = (analysis: Analysis, entrypoint: string): EntrypointInfo | undefined =>
  analysis.entrypoints[entrypoint]

const entrypointVisibleProblems = (
  analysis: Analysis,
  entrypoint: string,
  resolutionKind: ResolutionKind,
): readonly number[] | undefined => {
  const info = entrypointInfoAt(analysis, entrypoint)
  if (info === undefined) return undefined
  return resolutionVisibleProblems(info, resolutionKind)
}

const problemAffectsEntrypointResolution = (
  problem: Problem,
  entrypoint: string,
  resolutionKind: ResolutionKind,
  analysis: Analysis,
): boolean => {
  const index = getProblemIndex(analysis, problem)
  return includesProblemIndex(entrypointVisibleProblems(analysis, entrypoint, resolutionKind), index)
}

const passesKindFilter = (problem: Problem, kinds: readonly ProblemKind[] | undefined): boolean =>
  kinds === undefined || kinds.includes(problem.kind)

const optionMatchesEntrypoint = (
  problem: Problem,
  analysis: Analysis,
  entrypoint: string,
  resolutionOption: ResolutionOption,
): boolean =>
  getResolutionKinds(resolutionOption).every((resolutionKind) =>
    problemAffectsEntrypointResolution(problem, entrypoint, resolutionKind, analysis)
  )

const optionOrEntrypointFilterMatch = (
  problem: Problem,
  analysis: Analysis,
  filter: ProblemFilter,
  entrypoint: string,
): boolean => {
  if (filter.resolutionOption !== undefined) {
    return optionMatchesEntrypoint(problem, analysis, entrypoint, filter.resolutionOption)
  }
  return problemAffectsEntrypoint(problem, entrypoint, analysis)
}

const entrypointFilterMatch = (
  problem: Problem,
  analysis: Analysis,
  filter: ProblemFilter,
  entrypoint: string,
): boolean => {
  if (filter.resolutionKind !== undefined) {
    return problemAffectsEntrypointResolution(problem, entrypoint, filter.resolutionKind, analysis)
  }
  return optionOrEntrypointFilterMatch(problem, analysis, filter, entrypoint)
}

const resolutionKindFilterMatch = (
  problem: Problem,
  analysis: Analysis,
  resolutionKind: ResolutionKind | undefined,
): boolean => {
  if (resolutionKind === undefined) return true
  return problemAffectsResolutionKind(problem, resolutionKind, analysis)
}

const scopeFilterMatch = (problem: Problem, analysis: Analysis, filter: ProblemFilter): boolean => {
  if (filter.entrypoint === undefined) return resolutionKindFilterMatch(problem, analysis, filter.resolutionKind)
  return entrypointFilterMatch(problem, analysis, filter, filter.entrypoint)
}

const matchesProblemFilter = (problem: Problem, analysis: Analysis, filter: ProblemFilter): boolean => {
  if (!passesKindFilter(problem, filter.kind)) return false
  return scopeFilterMatch(problem, analysis, filter)
}

export const filterProblems = (
  problems: readonly Problem[],
  analysis: Analysis,
  filter: ProblemFilter,
): readonly Problem[] => problems.filter((problem) => matchesProblemFilter(problem, analysis, filter))

const appendProblemToKind = <K extends ProblemKind>(
  result: Partial<Record<K, (Problem & { kind: K })[]>>,
  problem: Problem & { kind: K },
): void => {
  const list = result[problem.kind]
  if (list === undefined) {
    result[problem.kind] = [problem]
    return
  }
  list.push(problem)
}

export const groupProblemsByKind = <K extends ProblemKind>(
  problems: readonly (Problem & { kind: K })[],
): Partial<Record<K, readonly (Problem & { kind: K })[]>> => {
  const result: Partial<Record<K, (Problem & { kind: K })[]>> = {}
  for (const problem of problems) appendProblemToKind(result, problem)
  return result
}
