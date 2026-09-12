import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const exportedSubpaths = ['./features/*.js', './browser'] as const
const unexportedSubpaths = ['./features/private-internal/*', './blocked'] as const

Feature('Entrypoint discovery across an export map with blocked subpaths').body(({ scenario }) => {
  scenario(
    'a subpath blocked under every condition is not reported as an entrypoint',
    Gherkin.Do.pipe(
      Given('a package whose export map blocks a private subpath and a browser subpath')(
        'pkg',
        () =>
          Effect.sync(() =>
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
          ),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('only the subpaths reachable under some condition are reported')(({ analysed }) => {
        expect('entrypoints' in analysed).toBe(true)
        if (!('entrypoints' in analysed)) {
          throw new Error('expected the analysis of a package carrying declarations')
        }
        for (const subpath of exportedSubpaths) {
          expect(analysed.entrypoints[subpath]).toBeDefined()
        }
        for (const subpath of unexportedSubpaths) {
          expect(analysed.entrypoints[subpath]).toBeUndefined()
        }
        expect(analysed.entrypoints['./features/*.js']?.isWildcard).toBe(true)
        expect(analysed.entrypoints['./browser']?.isWildcard).toBe(false)
      }),
    ),
  )
})
