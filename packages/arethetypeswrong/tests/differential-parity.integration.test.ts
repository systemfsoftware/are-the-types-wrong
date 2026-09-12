import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { checkPackage as publishedCheckPackage } from '@systemfsoftware/arethetypeswrong-published'
import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Package } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import * as Exit from 'effect/Exit'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const analyseAll = (
  engine: (pkg: Package) => Effect.Effect<unknown, Error>,
  corpus: readonly { readonly name: string; readonly pkg: Package }[],
): Effect.Effect<readonly string[]> =>
  Effect.forEach(
    corpus,
    (entry) =>
      engine(entry.pkg).pipe(
        Effect.exit,
        Effect.map((exit) =>
          `${entry.name} ${
            Exit.isSuccess(exit)
              ? JSON.stringify({ tag: 'ok', document: exit.value })
              : JSON.stringify({ tag: 'failure', cause: String(exit.cause) })
          }`
        ),
      ),
    { concurrency: 1 },
  )

Feature('Reproducing the published analysis of every synthetic package').body(({ scenario }) => {
  scenario(
    'every synthetic package analyses to the same outcome in both engines',
    Gherkin.Do.pipe(
      Given('a corpus of synthetic packages, one per problem kind')(
        'corpus',
        () => Effect.sync(() => Object.entries(recipes).map(([name, make]) => ({ name, pkg: make() }))),
      ),
      When('each package is analysed by the previously published engine')(
        'published',
        ({ corpus }) => analyseAll(publishedCheckPackage, corpus),
      ),
      When('each package is analysed by the engine under test')(
        'current',
        ({ corpus }) => analyseAll(checkPackage, corpus),
      ),
      Then('both engines report the same outcome for every package')(({ published, current }) =>
        Effect.sync(() => {
          expect(current).toEqual(published)
        })
      ),
    ),
  )
})
