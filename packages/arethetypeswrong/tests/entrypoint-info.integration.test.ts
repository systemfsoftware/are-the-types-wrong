import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const reachableSubpaths = [
  { subpath: './features/*.js', shape: 'a wildcard' },
  { subpath: './browser', shape: 'a literal' },
] as const

const blockedSubpaths = [{ subpath: './features/private-internal/*' }, { subpath: './blocked' }] as const

const authoredPackage = () =>
  createPackage({
    'dist/browser.d.ts': 'export {};',
    'dist/browser.js': 'export {};',
    'index.d.ts': 'export {};',
    'package.json': JSON.stringify({
      name: 'test',
      version: '1.0.0',
      exports: {
        './features/*.js': './src/features/*.js',
        './features/private-internal/*': null,
        './browser': {
          node: null,
          default: './dist/browser.js',
        },
        './blocked': {
          node: null,
          default: null,
        },
      },
    }),
    'src/features/public.js': 'export {};',
    'src/features/private-internal/hidden.js': 'export {};',
  })

Feature('Entrypoint discovery across an export map with blocked subpaths').body(({ scenarioOutline }) => {
  scenarioOutline(
    'the <subpath> subpath is reported as <shape>',
    reachableSubpaths,
    (row) =>
      Gherkin.Do.pipe(
        Given('a package whose export map reaches one subpath only under some condition')(
          'pkg',
          () => Effect.sync(authoredPackage),
        ),
        When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
        Then('the analysis reports the subpath with the authored wildcard shape')(({ analysed }) => {
          if (!('entrypoints' in analysed)) {
            throw new Error('expected the analysis of a package carrying declarations')
          }
          const entrypoint = analysed.entrypoints[row.subpath]
          expect(entrypoint).toBeDefined()
          expect(entrypoint?.isWildcard).toBe(row.shape === 'a wildcard')
        }),
      ),
  )

  scenarioOutline(
    'the <subpath> subpath is not reported',
    blockedSubpaths,
    (row) =>
      Gherkin.Do.pipe(
        Given('a package whose export map blocks a private subpath under every condition')(
          'pkg',
          () => Effect.sync(authoredPackage),
        ),
        When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
        Then('the analysis reports no entrypoint for the blocked subpath')(({ analysed }) => {
          if (!('entrypoints' in analysed)) {
            throw new Error('expected the analysis of a package carrying declarations')
          }
          expect(analysed.entrypoints[row.subpath]).toBeUndefined()
        }),
      ),
  )
})
