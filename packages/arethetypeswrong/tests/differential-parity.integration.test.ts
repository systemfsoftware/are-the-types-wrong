import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { checkPackage as publishedCheckPackage } from '@systemfsoftware/arethetypeswrong-published'
import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Package } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

type Engine = (pkg: Package) => Effect.Effect<object, unknown>
type Corpus = readonly { readonly name: string; readonly pkg: Package }[]

const namedProblems = [
  { recipe: 'FalseCJS', kind: 'FalseCJS' },
  { recipe: 'FalseESM', kind: 'FalseESM' },
  { recipe: 'CJSResolvesToESM', kind: 'CJSResolvesToESM' },
  { recipe: 'NamedExports', kind: 'NamedExports' },
  { recipe: 'FallbackCondition', kind: 'FallbackCondition' },
  { recipe: 'FalseExportDefault', kind: 'FalseExportDefault' },
  { recipe: 'MissingExportEquals', kind: 'MissingExportEquals' },
  { recipe: 'InternalResolutionError', kind: 'InternalResolutionError' },
  { recipe: 'UnexpectedModuleSyntax', kind: 'UnexpectedModuleSyntax' },
  { recipe: 'CJSOnlyExportsDefault', kind: 'CJSOnlyExportsDefault' },
  { recipe: 'NoResolution', kind: 'NoResolution' },
  { recipe: 'UntypedResolution', kind: 'UntypedResolution' },
] as const

const corpus: Corpus = Object.entries(recipes).map(([name, make]) => ({ name, pkg: make() }))

const kindOf = (problem: unknown): string => {
  if (problem !== null && typeof problem === 'object' && 'kind' in problem && typeof problem.kind === 'string') {
    return problem.kind
  }
  return '<unrecognised problem>'
}

const problemKindsOf = (analysed: object): readonly string[] => {
  if (!('problems' in analysed) || !Array.isArray(analysed.problems)) return []
  return analysed.problems.map(kindOf)
}

const analyse = (engine: Engine, pkg: Package): Effect.Effect<readonly string[], unknown> =>
  engine(pkg).pipe(Effect.map(problemKindsOf))

const outcomeOf = (engine: Engine, entry: { readonly name: string; readonly pkg: Package }) =>
  analyse(engine, entry.pkg).pipe(
    Effect.exit,
    Effect.map((exit) =>
      Match.value(exit).pipe(
        Match.tag('Success', (succeeded) => `${entry.name} ${[...succeeded.value].sort().join(',')}`),
        Match.tag('Failure', () => `${entry.name} Failed`),
        Match.exhaustive,
      )
    ),
  )

const analyseCorpus = (engine: Engine, packages: Corpus): Effect.Effect<readonly string[]> =>
  Effect.forEach(packages, (entry) => outcomeOf(engine, entry))

Feature('Reporting the problems a synthetic package was authored to produce').body(({ scenario, scenarioOutline }) => {
  scenarioOutline(
    'the <recipe> package is reported as <kind>',
    namedProblems,
    (row) =>
      Gherkin.Do.pipe(
        Given(`the ${row.recipe} synthetic package`)('pkg', () => Effect.sync(() => recipes[row.recipe]())),
        When('the package is analysed')('kinds', ({ pkg }) => analyse(checkPackage, pkg)),
        Then(`the analysis reports the ${row.kind} problem`)(({ kinds }) => {
          expect(kinds).toContain(row.kind)
        }),
      ),
  )

  scenario(
    'the published engine reports the same problems as the engine under test',
    Gherkin.Do.pipe(
      Given('the synthetic package corpus')('packages', () => Effect.sync(() => corpus)),
      When('both engines analyse every package')('outcomes', ({ packages }) =>
        Effect.all({
          published: analyseCorpus(publishedCheckPackage, packages),
          current: analyseCorpus(checkPackage, packages),
        })),
      Then('the engine under test reports what the published engine reported')(({ outcomes }) => {
        expect(outcomes.current).toEqual(outcomes.published)
      }),
      Then('only the package authored to be refused is refused')(({ outcomes }) => {
        expect(outcomes.published.filter((outcome) => outcome.endsWith(' Failed'))).toEqual(['KnownBad Failed'])
      }),
    ),
  )
})
