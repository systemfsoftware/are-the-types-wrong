import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const authoredTree = (packageName: string) => ({
  'package.json': JSON.stringify({
    name: packageName,
    version: '1.0.0',
    main: './index.js',
    types: './index.d.ts',
  }),
  'index.d.ts': 'export declare const x: number;\n',
  'index.js': 'export const x = 1;\n',
})

Feature('Package trees constructed from authored files').body(({ scenario }) => {
  scenario(
    'an unscoped package is reported from its own node_modules directory',
    Gherkin.Do.pipe(
      Given('an authored tree named demo')(
        'pkg',
        () => Effect.sync(() => createPackage(authoredTree('demo'), 'demo', '1.0.0')),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('the analysis names the authored package and resolves its declaration file')(({ analysed }) => {
        expect(analysed.packageName).toBe('demo')
        expect(analysed.packageVersion).toBe('1.0.0')
        if (!('entrypoints' in analysed)) {
          throw new Error('expected the analysis of a package carrying declarations')
        }
        expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
        expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(
          '/node_modules/demo/index.d.ts',
        )
      }),
    ),
  )

  scenario(
    'a scoped package is reported from its own scope directory',
    Gherkin.Do.pipe(
      Given('an authored tree named @acme/pkg')(
        'pkg',
        () => Effect.sync(() => createPackage(authoredTree('@acme/pkg'), '@acme/pkg', '1.0.0')),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('the analysis names the authored scoped package and resolves its declaration file')(({ analysed }) => {
        expect(analysed.packageName).toBe('@acme/pkg')
        expect(analysed.packageVersion).toBe('1.0.0')
        if (!('entrypoints' in analysed)) {
          throw new Error('expected the analysis of a package carrying declarations')
        }
        expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
        expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(
          '/node_modules/@acme/pkg/index.d.ts',
        )
      }),
    ),
  )
})
