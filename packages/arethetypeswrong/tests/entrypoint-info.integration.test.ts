import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Entrypoint discovery across an export map with blocked subpaths').body(({ scenario }) => {
  scenario(
    'a subpath whose targets are null under every condition is not reported',
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
      When('the package is analysed')('result', ({ pkg }) => checkPackage(pkg)),
      Then('only the reachable subpaths are reported')(({ result }) =>
        Effect.sync(() => {
          expect('entrypoints' in result).toBe(true)
          if ('entrypoints' in result) {
            expect(Object.keys(result.entrypoints)).toEqual(['./features/*.js', './browser'])
          }
        })
      ),
    ),
  )
})
