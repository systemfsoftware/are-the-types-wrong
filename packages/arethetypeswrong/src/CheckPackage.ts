import type { Package } from '@systemfsoftware/npm-package'
import { init as initCjsLexer } from 'cjs-module-lexer'
import { Effect, Match, MutableHashMap, Option } from 'effect'
import checks from './internal/checks/index.js'
import type { AnyCheck, CheckDependenciesContext } from './internal/DefineCheck.js'
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

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((entry) => typeof entry === 'string')
}

function getHomepage(pkg: Package, packageName: string): string | undefined {
  const packageJson: unknown = JSON.parse(pkg.readFile(`/node_modules/${packageName}/package.json`))
  if (typeof packageJson !== 'object' || packageJson === null || !('homepage' in packageJson)) {
    return undefined
  }
  if (typeof packageJson.homepage === 'string') {
    return packageJson.homepage
  }
  return undefined
}

function getDevDependencies(pkg: Package, packageName: string): { devDependencies?: Record<string, string> } {
  const packageJson: unknown = JSON.parse(pkg.readFile(`/node_modules/${packageName}/package.json`))
  if (typeof packageJson !== 'object' || packageJson === null || !('devDependencies' in packageJson)) {
    return {}
  }
  if (isStringRecord(packageJson.devDependencies)) {
    return { devDependencies: packageJson.devDependencies }
  }
  return {}
}
export const checkPackage = (
  input: Package | PackageWithCompanion,
  options?: CheckPackageOptions,
): Effect.Effect<CheckResult, Error> =>
  Effect.gen(function*() {
    let pkg: Package
    let companion: TypesCompanionInfo | undefined
    if (isPackageWithCompanion(input)) {
      pkg = input.pkg
      companion = input.companion
    } else {
      pkg = input
    }
    const types: AnalysisTypes | false = Match.value({
      companion,
      hasTypes: companion === undefined && containsTypes(pkg),
    }).pipe(
      Match.when({ companion: Match.defined }, ({ companion }) => ({
        kind: '@types' as const,
        ...companion,
        definitelyTypedUrl: getHomepage(pkg, companion.packageName),
      })),
      Match.when({ hasTypes: true }, () => ({ kind: 'included' as const })),
      Match.orElse(() => false as const),
    )
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

    // Collect cells first because visitResolutions is pure and synchronous;
    // we need an array to drive Effect.forEach over.
    const cells: { analysis: EntrypointResolutionAnalysis; info: { subpath: string } }[] = []
    visitResolutions(entrypointResolutions, (analysis, info) => {
      cells.push({ analysis, info })
    })

    yield* Effect.forEach(cells, ({ analysis, info }) =>
      Effect.gen(function*() {
        for (const check of checks) {
          const context = {
            pkg,
            hosts,
            entrypoints: entrypointResolutions,
            programInfo,
            subpath: info.subpath,
            resolutionKind: analysis.resolutionKind,
            resolutionOption: getResolutionOption(analysis.resolutionKind),
            fileName: undefined,
          }
          if (check.enumerateFiles === true) {
            for (const fileName of analysis.files ?? []) {
              yield* runCheck(check, { ...context, fileName }, analysis)
            }
            if (analysis.implementationResolution) {
              yield* runCheck(check, { ...context, fileName: analysis.implementationResolution.fileName }, analysis)
            }
          } else {
            yield* runCheck(check, context, analysis)
          }
        }
      }), { discard: true })

    return {
      packageName,
      packageVersion,
      types,
      buildTools: getBuildTools(getDevDependencies(pkg, packageName)),
      entrypoints: entrypointResolutions,
      programInfo,
      problems,
    }

    function runCheck(
      check: AnyCheck,
      context: CheckDependenciesContext<boolean>,
      analysis: EntrypointResolutionAnalysis,
    ): Effect.Effect<void> {
      return Effect.gen(function*() {
        const dependencies = check.dependencies(context)
        const id = check.name +
          JSON.stringify(dependencies, (_, value: unknown) => {
            if (typeof value === 'function') {
              throw new Error('Encountered unexpected function in check dependencies')
            }
            return value
          })
        const existing = MutableHashMap.get(problemIdsToIndices, id)
        if (Option.isSome(existing)) {
          ;(analysis.visibleProblems ??= []).push(...existing.value)
          return
        }
        const indices: number[] = []
        let gathered: unknown
        if (check.gather !== undefined) {
          gathered = yield* check.gather(dependencies, context)
        }
        const checkProblems = check.execute(dependencies, context, gathered)
        let checkProblemList: Problem[]
        if (Array.isArray(checkProblems)) {
          checkProblemList = checkProblems
        } else if (checkProblems !== undefined) {
          checkProblemList = [checkProblems]
        } else {
          checkProblemList = []
        }
        for (const problem of checkProblemList) {
          indices.push(problems.length)
          problems.push(problem)
        }
        MutableHashMap.set(problemIdsToIndices, id, indices)
        ;(analysis.visibleProblems ??= []).push(...indices)
      })
    }
  })
