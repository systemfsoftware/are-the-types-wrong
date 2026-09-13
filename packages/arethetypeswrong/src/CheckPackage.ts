import type { Package } from '@systemfsoftware/npm-package'
import { init as initCjsLexer } from 'cjs-module-lexer'
import { Effect, Match, MutableHashMap, Option, Predicate } from 'effect'
import checks from './internal/checks/index.js'
import type { AnyCheck, CheckDependenciesContext, CheckExecutionContext } from './internal/DefineCheck.js'
import { getBuildTools, getEntrypointInfo, getModuleKinds } from './internal/GetEntrypointInfo.js'
import { createCompilerHosts } from './internal/MultiCompilerHost.js'
import type {
  AnalysisTypes,
  CheckResult,
  EntrypointResolutionAnalysis,
  Problem,
  ProgramInfo,
  ResolutionOption,
} from './Types.js'
import {
  containsTypes,
  isPackageWithCompanion,
  type PackageWithCompanion,
  type TypesCompanionInfo,
} from './TypesCompanion.js'
import { getResolutionOption, visitResolutions } from './Utils.js'

export interface CheckPackageOptions {
  entrypoints?: string[]
  includeEntrypoints?: string[]
  excludeEntrypoints?: (string | RegExp)[]
  entrypointsLegacy?: boolean
}

interface ResolutionCell {
  readonly analysis: EntrypointResolutionAnalysis
  readonly info: { readonly subpath: string }
}

const readPackageJson = (pkg: Package, packageName: string): unknown => {
  const packageJson: unknown = JSON.parse(pkg.readFile(`/node_modules/${packageName}/package.json`))
  return packageJson
}

const packageJsonField = (pkg: Package, packageName: string, field: string): unknown => {
  const packageJson = readPackageJson(pkg, packageName)
  if (!Predicate.isObject(packageJson)) return undefined
  return packageJson[field]
}

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!Predicate.isObject(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

function getHomepage(pkg: Package, packageName: string): string | undefined {
  const homepage = packageJsonField(pkg, packageName, 'homepage')
  if (typeof homepage !== 'string') return undefined
  return homepage
}

function getDevDependencies(pkg: Package, packageName: string): { devDependencies?: Record<string, string> } {
  const devDependencies = packageJsonField(pkg, packageName, 'devDependencies')
  if (!isStringRecord(devDependencies)) return {}
  return { devDependencies }
}

const rejectFunctionDependency = (_: unknown, value: unknown): unknown => {
  if (typeof value === 'function') {
    throw new Error('Encountered unexpected function in check dependencies')
  }
  return value
}

const showProblems = (analysis: EntrypointResolutionAnalysis, indices: readonly number[]): void => {
  ;(analysis.visibleProblems ??= []).push(...indices)
}

const singleOrNoProblem = (problem: Problem | undefined): readonly Problem[] => {
  if (problem === undefined) return []
  return [problem]
}

const problemListOf = (checkProblems: Problem[] | Problem | undefined): readonly Problem[] => {
  if (Array.isArray(checkProblems)) return checkProblems
  return singleOrNoProblem(checkProblems)
}

const recordProblems = (problems: Problem[], checkProblems: readonly Problem[]): readonly number[] => {
  const indices: number[] = []
  for (const problem of checkProblems) {
    indices.push(problems.length)
    problems.push(problem)
  }
  return indices
}

const filesToCheck = (analysis: EntrypointResolutionAnalysis): readonly string[] => analysis.files ?? []

const gatherForCheck = (
  check: AnyCheck,
  dependencies: readonly unknown[],
  context: CheckExecutionContext,
): Effect.Effect<unknown> => {
  if (check.gather === undefined) return Effect.succeed(undefined)
  return check.gather(dependencies, context)
}

const unpackPackageInput = (
  input: Package | PackageWithCompanion,
): { readonly pkg: Package; readonly companion: TypesCompanionInfo | undefined } => {
  if (isPackageWithCompanion(input)) return { pkg: input.pkg, companion: input.companion }
  return { pkg: input, companion: undefined }
}

const hasIncludedTypes = (companion: TypesCompanionInfo | undefined, pkg: Package): boolean =>
  companion === undefined && containsTypes(pkg)

const analysisTypesOf = (companion: TypesCompanionInfo | undefined, pkg: Package): AnalysisTypes | false =>
  Match.value({ companion, hasTypes: hasIncludedTypes(companion, pkg) }).pipe(
    Match.when({ companion: Match.defined }, ({ companion }) => ({
      kind: '@types' as const,
      ...companion,
      definitelyTypedUrl: getHomepage(pkg, companion.packageName),
    })),
    Match.when({ hasTypes: true }, () => ({ kind: 'included' as const })),
    Match.orElse(() => false as const),
  )

export const checkPackage = (
  input: Package | PackageWithCompanion,
  options?: CheckPackageOptions,
): Effect.Effect<CheckResult, Error> =>
  Effect.gen(function*() {
    const { pkg, companion } = unpackPackageInput(input)
    const types: AnalysisTypes | false = analysisTypesOf(companion, pkg)
    const { packageName, packageVersion } = pkg
    if (types === false) {
      return { packageName, packageVersion, types }
    }

    const hosts = yield* createCompilerHosts(pkg)
    const entrypointResolutions = yield* getEntrypointInfo(packageName, pkg, hosts, options, companion)
    const programInfo: Record<ResolutionOption, ProgramInfo> = {
      node10: {},
      node16: { moduleKinds: getModuleKinds(entrypointResolutions, 'node16', hosts) },
      bundler: {},
    }

    yield* Effect.tryPromise({
      try: () => initCjsLexer(),
      catch: (cause) => new Error('Analysis failed', { cause }),
    })

    const problems: Problem[] = []
    const problemIdsToIndices = MutableHashMap.empty<string, number[]>()

    // Collect cells first because visitResolutions is pure and synchronous.
    const cells: ResolutionCell[] = []
    visitResolutions(entrypointResolutions, (analysis, info) => {
      cells.push({ analysis, info })
    })

    yield* Effect.forEach(cells, runChecksForCell, { discard: true })

    return {
      packageName,
      packageVersion,
      types,
      buildTools: getBuildTools(getDevDependencies(pkg, packageName)),
      entrypoints: entrypointResolutions,
      programInfo,
      problems,
    }

    function cellContext(
      analysis: EntrypointResolutionAnalysis,
      subpath: string,
    ): CheckDependenciesContext<boolean> {
      return {
        pkg,
        hosts,
        entrypoints: entrypointResolutions,
        programInfo,
        subpath,
        resolutionKind: analysis.resolutionKind,
        resolutionOption: getResolutionOption(analysis.resolutionKind),
        fileName: undefined,
      }
    }

    function runChecksForCell(cell: ResolutionCell): Effect.Effect<void> {
      return Effect.gen(function*() {
        for (const check of checks) {
          yield* runCheckForCell(check, cell)
        }
      })
    }

    function runCheckForCell(check: AnyCheck, cell: ResolutionCell): Effect.Effect<void> {
      return Effect.gen(function*() {
        const context = cellContext(cell.analysis, cell.info.subpath)
        if (check.enumerateFiles === true) {
          yield* runFileChecks(check, context, cell.analysis)
          return
        }
        yield* runCheck(check, context, cell.analysis)
      })
    }

    function runFileChecks(
      check: AnyCheck,
      context: CheckDependenciesContext<boolean>,
      analysis: EntrypointResolutionAnalysis,
    ): Effect.Effect<void> {
      return Effect.gen(function*() {
        for (const fileName of filesToCheck(analysis)) {
          yield* runCheck(check, { ...context, fileName }, analysis)
        }
        yield* runImplementationCheck(check, context, analysis)
      })
    }

    function runImplementationCheck(
      check: AnyCheck,
      context: CheckDependenciesContext<boolean>,
      analysis: EntrypointResolutionAnalysis,
    ): Effect.Effect<void> {
      return Effect.gen(function*() {
        const implementationResolution = analysis.implementationResolution
        if (implementationResolution === undefined) return
        yield* runCheck(check, { ...context, fileName: implementationResolution.fileName }, analysis)
      })
    }

    function runCheck(
      check: AnyCheck,
      context: CheckDependenciesContext<boolean>,
      analysis: EntrypointResolutionAnalysis,
    ): Effect.Effect<void> {
      return Effect.gen(function*() {
        const dependencies = check.dependencies(context)
        const id = check.name + JSON.stringify(dependencies, rejectFunctionDependency)
        const existing = MutableHashMap.get(problemIdsToIndices, id)
        if (Option.isSome(existing)) {
          showProblems(analysis, existing.value)
          return
        }
        const gathered = yield* gatherForCheck(check, dependencies, context)
        const checkProblems = check.execute(dependencies, context, gathered)
        const indices = recordProblems(problems, problemListOf(checkProblems))
        MutableHashMap.set(problemIdsToIndices, id, indices)
        showProblems(analysis, indices)
      })
    }
  })
