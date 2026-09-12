import { PackageStore, PackageStoreLive, PackageStoreStub } from '@systemfsoftware/arethetypeswrong'
import { Gherkin, Given, it, layer, makeFeature, pairwiseFor, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Predicate } from 'effect'
import { afterEach, expect, vi } from 'vitest'

const Feature = makeFeature({ it, layer })

const registryBaseUrl = 'http://registry.fixture'
const tarballPath = '/fake-vs-real/-/fake-vs-real-1.2.3.tgz'
const recordedTarball = new Uint8Array([7, 7, 7])
const tarballUrl = `${registryBaseUrl}${tarballPath}`
const recordedRef = { packageName: 'fake-vs-real', packageVersion: '1.2.3', tarballUrl }

const spec = [{ name: 'fake-vs-real', versionKind: 'tag', version: 'latest' }] as const

const urlOf = (input: RequestInfo | URL): string => {
  if (input instanceof URL) return input.href
  if (typeof input === 'string') return input
  return input.url
}

const answerWith = (document: unknown): string => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input) === tarballUrl) return new Response(recordedTarball, { status: 200 })
      return new Response(JSON.stringify(document), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return registryBaseUrl
}

const recordedStore = PackageStoreStub(recordedRef, recordedTarball)

const resolveAndFetch = Effect.gen(function*() {
  const service = yield* PackageStore
  const ref = yield* service.resolveTarballRef(spec, { registryBaseUrl })
  const bytes = yield* service.fetchTarball(ref.tarballUrl)
  return { ref, bytes }
})

const resolveThroughLive = Effect.gen(function*() {
  const service = yield* PackageStore
  return yield* Effect.flip(service.resolveTarballRef(spec, { registryBaseUrl }))
}).pipe(Effect.provide(PackageStoreLive))

const resolveThroughRecorded = Effect.gen(function*() {
  const service = yield* PackageStore
  return yield* service.resolveTarballRef(spec, { registryBaseUrl })
}).pipe(Effect.provide(recordedStore))

afterEach(() => {
  vi.unstubAllGlobals()
})

Feature('A recorded package store standing in for the live registry').body(({ scenario }) => {
  scenario(
    'both stores answer the same spec with the same reference and bytes',
    Gherkin.Do.pipe(
      Given('a registry answering with the recorded manifest and tarball')(
        'registry',
        () => Effect.sync(() => answerWith({ version: '1.2.3', dist: { tarball: tarballUrl } })),
      ),
      pairwiseFor(
        {
          a: { name: 'recorded', layer: recordedStore },
          b: { name: 'live', layer: PackageStoreLive },
        },
        PackageStore,
      )('the latest reference and its bytes are asked of the store')(
        'resolution',
        () => (service) => resolveAndFetch.pipe(Effect.provideService(PackageStore, service)),
      ),
      Then('both stores name the same package, version and tarball url')(({ resolution }) =>
        Effect.sync(() => {
          expect(resolution.a.ref).toEqual(resolution.b.ref)
        })
      ),
      Then('both stores hand back the same bytes')(({ resolution }) =>
        Effect.sync(() => {
          expect([...resolution.a.bytes]).toEqual([...resolution.b.bytes])
        })
      ),
    ),
  )

  scenario(
    'the live registry refuses a miss the recorded store does not model',
    Gherkin.Do.pipe(
      Given('a registry answering that the package was not found')(
        'registry',
        () => Effect.sync(() => answerWith({ error: 'Not found' })),
      ),
      When('the same spec is resolved through the live registry and through the recorded store')(
        'outcomes',
        () =>
          Effect.all({
            live: resolveThroughLive.pipe(Effect.mapError(() => 'unexpected-succeed')),
            recorded: resolveThroughRecorded,
          }),
      ),
      Then('the live registry reports a package-not-found failure')(({ outcomes }) =>
        Effect.sync(() => {
          expect(Predicate.isTagged(outcomes.live, 'PackageNotFoundError')).toBe(true)
        })
      ),
      Then('the recorded store still answers with its recorded reference')(({ outcomes }) =>
        Effect.sync(() => {
          expect(outcomes.recorded).toEqual(recordedRef)
        })
      ),
    ),
  )
})
