import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Package trees constructed from authored files').body(({ scenario }) => {
  scenario(
    'an authored tree is mounted under its package name inside node_modules',
    Gherkin.Do.pipe(
      Given('an authored tree with a relative package.json and a declaration file')(
        'pkg',
        () =>
          Effect.sync(() =>
            createPackage(
              {
                'package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
                'index.d.ts': 'export declare const x: number',
              },
              'demo',
              '1.0.0',
            )
          ),
      ),
      When('the package is mounted and analysed')('result', ({ pkg }) =>
        Effect.gen(function*() {
          expect(pkg.fileExists('/node_modules/demo/package.json')).toBe(true)
          expect(pkg.fileExists('/node_modules/demo/index.d.ts')).toBe(true)
          return yield* checkPackage(pkg)
        })),
      Then('the analysis reports entrypoints for the mounted package')(({ result }) =>
        Effect.sync(() => {
          expect('entrypoints' in result).toBe(true)
        })
      ),
    ),
  )

  scenario(
    'a scoped package name is mounted under its scope directory',
    Gherkin.Do.pipe(
      Given('an authored tree whose package name is scoped')('pkg', () =>
        Effect.sync(() =>
          createPackage(
            {
              'package.json': JSON.stringify({ name: '@acme/pkg', version: '1.0.0' }),
              'index.d.ts': 'export {}',
            },
            '@acme/pkg',
            '1.0.0',
          )
        )),
      When('the package is mounted and analysed')('result', ({ pkg }) =>
        Effect.gen(function*() {
          expect(pkg.fileExists('/node_modules/@acme/pkg/package.json')).toBe(true)
          expect(pkg.fileExists('/node_modules/@acme/pkg/index.d.ts')).toBe(true)
          return yield* checkPackage(pkg)
        })),
      Then('the analysis reports entrypoints for the scoped package')(({ result }) =>
        Effect.sync(() => {
          expect('entrypoints' in result).toBe(true)
        })
      ),
    ),
  )
})
