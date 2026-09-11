import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { hello } from '@TODO/starter'

const Feature = makeFeature({ it, layer })

Feature('Greeting visitors by name').body(({ scenario }) => {
  scenario(
    'A visitor who shared their name is greeted by name',
    Gherkin.Do.pipe(
      Given('a visitor arrived with the name "world"')('name', () => Effect.succeed('world')),
      When('the host greets the visitor')('greeting', (s) => Effect.succeed(hello(s.name))),
      Then('the greeting addresses the visitor by name')((s) => {
        expect(s.greeting).toBe('hello world')
      }),
    ),
  )
})
