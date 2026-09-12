import { PackageStore, PackageStoreStub } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const recordedRef = {
  packageName: 'stubbed-pkg',
  packageVersion: '1.0.0',
  tarballUrl: 'https://registry.example/stubbed.tgz',
}

Feature('A recorded package store serving a tarball reference').body(({ scenario }) => {
  scenario(
    'the recorded reference is returned when a stored spec is resolved',
    { scenarioLayer: PackageStoreStub(recordedRef, new Uint8Array([7, 7, 7])) },
    Gherkin.Do.pipe(
      Given('a recorded package name and version')(
        'expected',
        () => Effect.sync(() => ({ packageName: 'stubbed-pkg', packageVersion: '1.0.0' })),
      ),
      When('the stored spec is resolved through the package store')('ref', () =>
        Effect.gen(function*() {
          const store = yield* PackageStore
          return yield* store.resolveTarballRef([{ name: 'stubbed-pkg', versionKind: 'tag', version: 'latest' }])
        })),
      Then('the resolved reference carries the recorded name and version')(({ expected, ref }) =>
        Effect.sync(() => {
          expect(ref.packageName).toBe(expected.packageName)
          expect(ref.packageVersion).toBe(expected.packageVersion)
          expect(ref.tarballUrl).toBe(recordedRef.tarballUrl)
        })
      ),
    ),
  )

  scenario(
    'the injected reference is returned when another record is bound',
    {
      scenarioLayer: PackageStoreStub(
        { packageName: 'renamed-pkg', packageVersion: '2.0.0', tarballUrl: 'https://registry.example/renamed.tgz' },
        new Uint8Array([9, 9, 9]),
      ),
    },
    Gherkin.Do.pipe(
      Given('a recorded package name and version')(
        'expected',
        () => Effect.sync(() => ({ packageName: 'renamed-pkg', packageVersion: '2.0.0' })),
      ),
      When('the stored spec is resolved through the package store')('ref', () =>
        Effect.gen(function*() {
          const store = yield* PackageStore
          return yield* store.resolveTarballRef([{ name: 'renamed-pkg', versionKind: 'tag', version: 'latest' }])
        })),
      Then('the resolved reference carries the injected name and version')(({ expected, ref }) =>
        Effect.sync(() => {
          expect(ref.packageName).toBe(expected.packageName)
          expect(ref.packageVersion).toBe(expected.packageVersion)
          expect(ref.tarballUrl).toBe('https://registry.example/renamed.tgz')
        })
      ),
    ),
  )
})
