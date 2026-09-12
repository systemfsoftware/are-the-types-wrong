import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const authoredProblems = [
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

const declarationPlacements = [
  { placement: 'inside its own directory', verdict: 'shipping its own declarations' },
  { placement: 'in a sibling directory beside it', verdict: 'shipping no declarations' },
] as const

const recipeCount = Object.entries(recipes).length

const generatedPackageTree = (variant: number, placement: (typeof declarationPlacements)[number]['placement']) => {
  const directories = ['dist', 'build', 'lib'] as const
  const moduleNames = ['index', 'main', 'entry'] as const
  const directory = directories[variant % directories.length]!
  const moduleName = moduleNames[(variant + 1) % moduleNames.length]!
  const packageName = `generated-tree-${variant}`
  const siblingName = `generated-sibling-${variant}`
  const declarationPath = `${directory}/${moduleName}.d.ts`
  const modulePath = `${directory}/${moduleName}.js`
  const declarationsInside = placement === 'inside its own directory'
  const manifestFor = (name: string, withTypes: boolean) =>
    JSON.stringify({
      name,
      version: '1.0.0',
      main: `./${modulePath}`,
      ...(withTypes ? { types: `./${declarationPath}` } : {}),
    })

  return {
    packageName,
    declarationPath,
    subject: createPackage(
      {
        'package.json': manifestFor(packageName, declarationsInside),
        [modulePath]: 'export const value = 1;\n',
        ...(declarationsInside ? { [declarationPath]: 'export declare const value: number;\n' } : {}),
      },
      packageName,
      '1.0.0',
    ),
    sibling: createPackage(
      {
        'package.json': manifestFor(siblingName, !declarationsInside),
        [declarationPath]: 'export declare const value: number;\n',
      },
      siblingName,
      '1.0.0',
    ),
  }
}

Feature('The problems a synthetic package was authored to produce').body(({ scenario, scenarioOutline }) => {
  scenarioOutline(
    'the <recipe> package is reported as <kind>',
    authoredProblems,
    (row) =>
      Gherkin.Do.pipe(
        Given(`the ${row.recipe} synthetic package`)('pkg', () => Effect.sync(() => recipes[row.recipe]())),
        When('the package is analysed')('kinds', ({ pkg }) =>
          checkPackage(pkg).pipe(
            Effect.map((analysed) => ('problems' in analysed ? analysed.problems.map((problem) => problem.kind) : [])),
          )),
        Then(`the analysis reports the ${row.kind} problem`)(({ kinds }) => {
          expect(kinds).toContain(row.kind)
        }),
      ),
  )

  scenarioOutline(
    'a generated package whose declarations live <placement> is reported as <verdict>',
    declarationPlacements,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a generated package tree whose declarations live ${row.placement}, with a sibling package beside it`)(
          'generated',
          () =>
            Effect.sync(() =>
              generatedPackageTree(row.placement === 'inside its own directory' ? 0 : 1, row.placement)
            ),
        ),
        When('the generated package is analysed')('analysed', ({ generated }) => checkPackage(generated.subject)),
        Then(`the analysed package is reported as ${row.verdict}`)(({ analysed, generated }) => {
          expect(analysed.packageName).toBe(generated.packageName)
          Match.value(row.verdict).pipe(
            Match.when('shipping its own declarations', () => {
              expect(analysed.types).toMatchObject({ kind: 'included' })
              if (!('entrypoints' in analysed)) {
                throw new Error('expected the analysis of a package carrying declarations')
              }
              expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
              expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(
                `/node_modules/${generated.packageName}/${generated.declarationPath}`,
              )
            }),
            Match.when('shipping no declarations', () => {
              expect(analysed.types).toBe(false)
              expect('entrypoints' in analysed).toBe(false)
            }),
            Match.exhaustive,
          )
        }),
      ),
  )

  scenario(
    'only the package authored to be refused fails analysis',
    Gherkin.Do.pipe(
      Given('every synthetic recipe package')(
        'packages',
        () => Effect.sync(() => Object.entries(recipes).map(([name, make]) => ({ name, pkg: make() }))),
      ),
      When('the engine analyses every package')(
        'outcomes',
        ({ packages }) =>
          Effect.forEach(packages, (entry) =>
            checkPackage(entry.pkg).pipe(
              Effect.exit,
              Effect.map((exit) => ({
                name: entry.name,
                outcome: Match.value(exit).pipe(
                  Match.tag('Success', () => 'analysed' as const),
                  Match.tag('Failure', () => 'refused' as const),
                  Match.exhaustive,
                ),
              })),
            )),
      ),
      Then('exactly the known-bad package is refused and every other package is analysed')(({ outcomes }) => {
        const refused = outcomes.filter((entry) => entry.outcome === 'refused').map((entry) => entry.name)
        const analysed = outcomes.filter((entry) => entry.outcome === 'analysed')
        expect(refused).toEqual(['KnownBad'])
        expect(analysed.length).toBe(recipeCount - 1)
      }),
    ),
  )
})
