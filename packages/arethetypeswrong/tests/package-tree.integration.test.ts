import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const authoredMounts = [
  { name: 'demo', mount: '/node_modules/demo/index.d.ts' },
  { name: '@acme/pkg', mount: '/node_modules/@acme/pkg/index.d.ts' },
] as const

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

Feature('Package trees constructed from authored files').body(({ scenarioOutline }) => {
  scenarioOutline(
    'the <name> package is reported from the directory it was mounted at',
    authoredMounts,
    (row) =>
      Gherkin.Do.pipe(
        Given('an authored tree mounted under its own name')(
          'pkg',
          () => Effect.sync(() => createPackage(authoredTree(row.name), row.name, '1.0.0')),
        ),
        When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
        Then('the analysis names the package and resolves its declaration file')(({ analysed }) => {
          expect(analysed.packageName).toBe(row.name)
          expect(analysed.packageVersion).toBe('1.0.0')
          if (!('entrypoints' in analysed)) {
            throw new Error('expected the analysis of a package carrying declarations')
          }
          expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
          expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(row.mount)
        }),
      ),
  )
})
