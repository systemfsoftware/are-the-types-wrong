import { checkPackage, containsTypes, withTypesCompanion } from '@systemfsoftware/arethetypeswrong'
import type { EntrypointInfo } from '@systemfsoftware/arethetypeswrong'
import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Declarations shipped by a package and by its companion').body(({ scenario }) => {
  scenario(
    'only the package carrying a declaration file is reported as shipping types',
    Gherkin.Do.pipe(
      Given('a package with a declaration file beside one without')('packages', () =>
        Effect.sync(() => ({
          declared: createPackage(
            {
              'package.json': JSON.stringify({ name: 'with-types', version: '1.0.0' }),
              'index.d.ts': 'export declare const x: number;',
              'index.js': 'export const x = 1;',
            },
            'with-types',
            '1.0.0',
          ),
          undeclared: createPackage(
            {
              'package.json': JSON.stringify({ name: 'without-types', version: '1.0.0' }),
              'index.js': 'export const x = 1;',
            },
            'without-types',
            '1.0.0',
          ),
        }))),
      When('each package is asked whether it ships declarations')('answers', ({ packages }) =>
        Effect.sync(() => ({
          declaredWholeTree: containsTypes(packages.declared),
          declaredOwnDirectory: containsTypes(packages.declared, '/node_modules/with-types/'),
          undeclaredWholeTree: containsTypes(packages.undeclared),
          undeclaredOwnDirectory: containsTypes(packages.undeclared, '/node_modules/without-types/'),
        }))),
      Then('the package with the declaration file answers true in both scopes')(({ answers }) =>
        Effect.sync(() => {
          expect(answers.declaredWholeTree).toBe(true)
          expect(answers.declaredOwnDirectory).toBe(true)
          expect(answers.undeclaredWholeTree).toBe(false)
          expect(answers.undeclaredOwnDirectory).toBe(false)
        })
      ),
    ),
  )

  scenario(
    'declarations are found only inside the queried directory',
    Gherkin.Do.pipe(
      Given('a package whose declarations live under a dist directory')('pkg', () =>
        Effect.sync(() =>
          createPackage(
            {
              'package.json': JSON.stringify({ name: 'scoped-dir', version: '1.0.0' }),
              'dist/index.d.ts': 'export declare const x: number;',
              'dist/index.js': 'export const x = 1;',
              'src/index.js': 'export const y = 2;',
            },
            'scoped-dir',
            '1.0.0',
          )
        )),
      When('different directories of that package are queried')('answers', ({ pkg }) =>
        Effect.sync(() => ({
          dist: containsTypes(pkg, '/node_modules/scoped-dir/dist/'),
          src: containsTypes(pkg, '/node_modules/scoped-dir/src/'),
          wholeTree: containsTypes(pkg, '/'),
          absentDirectory: containsTypes(pkg, '/node_modules/scoped-dir/other/'),
        }))),
      Then('only the directory holding a declaration file answers true')(({ answers }) =>
        Effect.sync(() => {
          expect(answers.dist).toBe(true)
          expect(answers.src).toBe(false)
          expect(answers.wholeTree).toBe(true)
          expect(answers.absentDirectory).toBe(false)
        })
      ),
    ),
  )

  scenario(
    'a package paired with its companion reports the companion identity and no problems',
    Gherkin.Do.pipe(
      Given('the types-companion recipe pair')(
        'paired',
        () => Effect.sync(() => withTypesCompanion(recipes.TypesCompanion(), recipes.TypesCompanionTypes())),
      ),
      When('the paired package is analysed')('result', ({ paired }) => checkPackage(paired)),
      Then('the analysis reports the companion identity and an empty problem set')(({ result }) =>
        Effect.sync(() => {
          expect(result.packageName).toBe('types-companion')
          expect(result.packageVersion).toBe('1.0.0')
          expect('types' in result).toBe(true)
          if ('types' in result) {
            expect(result.types).toMatchObject({
              kind: '@types',
              packageName: '@types/types-companion',
              packageVersion: '1.0.0',
            })
          }
          expect('problems' in result).toBe(true)
          if ('problems' in result) {
            expect(result.problems).toEqual([])
          }
          expect('entrypoints' in result).toBe(true)
          if ('entrypoints' in result) {
            const entrypoint: EntrypointInfo | undefined = result.entrypoints['.']
            expect(entrypoint).toBeDefined()
          }
        })
      ),
    ),
  )

  scenario(
    'a package built from an authored tree is accepted by the analysis',
    Gherkin.Do.pipe(
      Given('a package constructed from an authored tree')('pkg', () =>
        Effect.sync(() =>
          createPackage(
            {
              'package.json': JSON.stringify({ name: 'call-shape', version: '1.0.0' }),
              'index.d.ts': 'export declare const x: number;',
              'index.js': 'export const x = 1;',
            },
            'call-shape',
            '1.0.0',
          )
        )),
      When('the analysis is invoked on that package')(
        'analysed',
        ({ pkg }) =>
          Effect.sync(() => checkPackage(pkg)).pipe(
            Effect.flatMap((effect) => Effect.sync(() => Effect.isEffect(effect))),
            Effect.flatMap(() => checkPackage(pkg)),
          ),
      ),
      Then('the analysis names the package it analysed')(({ analysed }) =>
        Effect.sync(() => {
          expect(analysed.packageName).toBe('call-shape')
        })
      ),
    ),
  )
})
