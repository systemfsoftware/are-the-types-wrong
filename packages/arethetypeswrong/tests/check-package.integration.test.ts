import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Analysis of a synthetic named-exports package').body(({ scenario }) => {
  scenario(
    'the named-exports recipe analyses to its root entrypoint',
    Gherkin.Do.pipe(
      Given('the named-exports recipe package')('pkg', () => Effect.sync(() => recipes.NamedExports())),
      When('the package is analysed')('result', ({ pkg }) => checkPackage(pkg)),
      Then('the analysis names the package and reports its root entrypoint')(({ result }) =>
        Effect.sync(() => {
          expect(result.packageName).toBe('named-exports')
          expect('entrypoints' in result).toBe(true)
          if ('entrypoints' in result) {
            expect(Object.keys(result.entrypoints)).toContain('.')
          }
        })
      ),
    ),
  )
})
