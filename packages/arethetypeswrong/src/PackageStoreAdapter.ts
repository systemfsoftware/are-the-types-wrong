import { Context, Effect, Layer, Option, Schema } from 'effect'
import { maxSatisfying } from 'semver'

import { type NpmRegistryDoc, NpmRegistryDocSchema } from './NpmRegistry.schema.js'
import type { ParsedPackageSpec } from './PackageSpec.schema.js'
import { PackageNotFoundError, PackageStoreError } from './PackageStore.schema.js'

export interface PackageStoreTarballRef {
  readonly packageName: string
  readonly packageVersion: string
  readonly tarballUrl: string
}

export { PackageNotFoundError, PackageStoreError }

export interface PackageStoreOptions {
  readonly before?: Date
  readonly allowDeprecated?: boolean
  readonly registryBaseUrl?: string
}

export interface PackageStoreService {
  readonly resolveTarballRef: (
    specs: readonly ParsedPackageSpec[],
    options?: PackageStoreOptions,
  ) => Effect.Effect<PackageStoreTarballRef, PackageNotFoundError | PackageStoreError>
  readonly fetchTarball: (tarballUrl: string) => Effect.Effect<Uint8Array, PackageStoreError>
}

export class PackageStore extends Context.Service<PackageStore, PackageStoreService>()(
  '@systemfsoftware/arethetypeswrong/PackageStore',
) {}

export const PackageStoreLive: Layer.Layer<PackageStore, never, never> = Layer.succeed(
  PackageStore,
  {
    resolveTarballRef: (specs, options) =>
      Effect.tryPromise({
        try: () => resolveTarballRef(specs, options),
        catch: (e): PackageNotFoundError | PackageStoreError => {
          if (e instanceof PackageNotFoundError) {
            return e
          }
          return new PackageStoreError({ message: `Failed to resolve ${nameOf(specs)}`, cause: e })
        },
      }),
    fetchTarball: (tarballUrl) =>
      Effect.tryPromise({
        try: () => fetchTarball(tarballUrl),
        catch: (e) => new PackageStoreError({ message: `Failed to fetch ${tarballUrl}`, cause: e }),
      }),
  },
)

export const PackageStoreStub = (
  ref: PackageStoreTarballRef,
  tarball: Uint8Array,
): Layer.Layer<PackageStore, never, never> =>
  Layer.succeed(PackageStore, {
    resolveTarballRef: () => Effect.succeed(ref),
    fetchTarball: () => Effect.succeed(tarball),
  })

type RegistryVersions = NonNullable<NpmRegistryDoc['versions']>

interface RegistryScan {
  readonly baseUrl: string
  readonly options: PackageStoreOptions
  readonly packument: unknown
}

const firstSpecName = (specs: readonly ParsedPackageSpec[]): string | undefined => specs[0]?.name

const nameOf = (specs: readonly ParsedPackageSpec[]): string => firstSpecName(specs) ?? '<no spec>'

const decodeRegistryDoc = Schema.decodeUnknownOption(NpmRegistryDocSchema)

const registryBaseUrl = (options: PackageStoreOptions): string =>
  options.registryBaseUrl ?? 'https://registry.npmjs.org'

const isNonExactSpec = (spec: ParsedPackageSpec): boolean => spec.versionKind !== 'exact'

const includesTimes = (packageSpecs: readonly ParsedPackageSpec[], options: PackageStoreOptions): boolean =>
  options.before !== undefined && packageSpecs.some(isNonExactSpec)

const acceptHeader = (packageSpecs: readonly ParsedPackageSpec[], options: PackageStoreOptions): string => {
  if (includesTimes(packageSpecs, options)) return 'application/json'
  return 'application/vnd.npm.install-v1+json'
}

const fetchJson = async (
  url: string,
  init?: { readonly headers: Record<string, string> },
): Promise<unknown> => fetch(url, init).then((response) => response.json())

const packumentUrl = (baseUrl: string, packageSpecs: readonly ParsedPackageSpec[]): string =>
  `${baseUrl}/${nameOf(packageSpecs)}`

const isNamedTagSpec = (spec: ParsedPackageSpec): boolean => spec.versionKind === 'tag' && spec.version !== 'latest'

const needsPackumentLookup = (spec: ParsedPackageSpec): boolean => spec.versionKind === 'range' || isNamedTagSpec(spec)

const needsPackument = (packageSpecs: readonly ParsedPackageSpec[]): boolean => packageSpecs.some(needsPackumentLookup)

async function packumentFor(
  baseUrl: string,
  packageSpecs: readonly ParsedPackageSpec[],
  options: PackageStoreOptions,
): Promise<unknown> {
  if (!needsPackument(packageSpecs)) return undefined
  return fetchJson(packumentUrl(baseUrl, packageSpecs), { headers: { accept: acceptHeader(packageSpecs, options) } })
}

const manifestUrlFor = (scan: RegistryScan, spec: ParsedPackageSpec): string =>
  `${scan.baseUrl}/${spec.name}/${spec.version || 'latest'}`

const registryPayload = async (scan: RegistryScan, manifestUrl: string): Promise<unknown> =>
  scan.packument ?? fetchJson(manifestUrl)

const decodeDoc = (payload: unknown, manifestUrl: string): NpmRegistryDoc => {
  const decoded = decodeRegistryDoc(payload)
  if (Option.isNone(decoded)) {
    throw new PackageStoreError({ message: `Unexpected response from ${manifestUrl}` })
  }
  return decoded.value
}

const isRegistryError = (doc: NpmRegistryDoc): boolean => doc.error !== undefined && doc.error !== 'Not found'

const assertRegistryDoc = (doc: NpmRegistryDoc, manifestUrl: string): NpmRegistryDoc => {
  if (isRegistryError(doc)) {
    throw new PackageStoreError({ message: `Unexpected response from ${manifestUrl}: ${doc.error}` })
  }
  return doc
}

const tarballUrlIn = (versions: RegistryVersions, packageVersion: string): string | undefined =>
  versions[packageVersion]?.dist.tarball

const tarballRefOf = (
  packageName: string,
  packageVersion: string,
  tarballUrl: string | undefined,
): PackageStoreTarballRef | undefined => {
  if (tarballUrl === undefined) return undefined
  return { packageName, packageVersion, tarballUrl }
}

const isDeprecatedVersion = (versions: RegistryVersions, version: string): boolean =>
  versions[version]?.deprecated !== undefined

const isCandidateVersion = (
  versions: RegistryVersions,
  version: string,
  options: PackageStoreOptions,
): boolean => options.allowDeprecated === true || !isDeprecatedVersion(versions, version)

const candidateVersions = (versions: RegistryVersions, options: PackageStoreOptions): readonly string[] =>
  Object.keys(versions).filter((version) => isCandidateVersion(versions, version, options))

const maxSatisfyingTarballRef = (
  versions: RegistryVersions,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
): PackageStoreTarballRef | undefined => {
  const packageVersion = maxSatisfying(candidateVersions(versions, options), spec.version)
  if (packageVersion === null) return undefined
  return tarballRefOf(spec.name, packageVersion, tarballUrlIn(versions, packageVersion))
}

const rangeTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
): PackageStoreTarballRef | undefined => {
  const versions = doc.versions
  if (versions === undefined) return undefined
  return maxSatisfyingTarballRef(versions, spec, options)
}

const distTagVersion = (doc: NpmRegistryDoc, tag: string): string | undefined => doc['dist-tags']?.[tag]

const publishedAt = (doc: NpmRegistryDoc, packageVersion: string): string | undefined => doc.time?.[packageVersion]

const isPublishedAfter = (doc: NpmRegistryDoc, packageVersion: string, before: Date): boolean => {
  const published = publishedAt(doc, packageVersion)
  if (published === undefined) return false
  return new Date(published) > before
}

const isExcludedByBefore = (
  doc: NpmRegistryDoc,
  packageVersion: string,
  options: PackageStoreOptions,
): boolean => options.before !== undefined && isPublishedAfter(doc, packageVersion, options.before)

const tarballUrlInDocVersions = (doc: NpmRegistryDoc, packageVersion: string): string | undefined => {
  const versions = doc.versions
  if (versions === undefined) return undefined
  return tarballUrlIn(versions, packageVersion)
}

const publishedTagTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
  packageVersion: string,
): PackageStoreTarballRef | undefined => {
  if (isExcludedByBefore(doc, packageVersion, options)) return undefined
  return tarballRefOf(spec.name, packageVersion, tarballUrlInDocVersions(doc, packageVersion))
}

const namedTagTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
): PackageStoreTarballRef | undefined => {
  const packageVersion = distTagVersion(doc, spec.version)
  if (packageVersion === undefined) return undefined
  return publishedTagTarballRef(doc, spec, options, packageVersion)
}

const distTarballUrl = (doc: NpmRegistryDoc): string | undefined => doc.dist?.tarball

const docVersionOrLatestTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
): PackageStoreTarballRef | undefined => {
  const docVersion = doc.version
  if (docVersion === undefined) return latestTagTarballRef(doc, spec)
  return tarballRefOf(spec.name, docVersion, distTarballUrl(doc))
}

const latestTagTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
): PackageStoreTarballRef | undefined => {
  const packageVersion = distTagVersion(doc, 'latest')
  if (packageVersion === undefined) return undefined
  return tarballRefOf(spec.name, packageVersion, tarballUrlInDocVersions(doc, packageVersion))
}

const tarballFor = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
): PackageStoreTarballRef | undefined => {
  if (spec.versionKind === 'range') return rangeTarballRef(doc, spec, options)
  return nonRangeTarballRef(doc, spec, options)
}

const nonRangeTarballRef = (
  doc: NpmRegistryDoc,
  spec: ParsedPackageSpec,
  options: PackageStoreOptions,
): PackageStoreTarballRef | undefined => {
  if (isNamedTagSpec(spec)) return namedTagTarballRef(doc, spec, options)
  return docVersionOrLatestTarballRef(doc, spec)
}

async function tarballRefForSpec(
  scan: RegistryScan,
  spec: ParsedPackageSpec,
): Promise<PackageStoreTarballRef | undefined> {
  const manifestUrl = manifestUrlFor(scan, spec)
  const doc = assertRegistryDoc(decodeDoc(await registryPayload(scan, manifestUrl), manifestUrl), manifestUrl)
  return tarballFor(doc, spec, scan.options)
}

const refOrContinueScan = async (
  scan: RegistryScan,
  packageSpecs: readonly ParsedPackageSpec[],
  index: number,
  pending: Promise<PackageStoreTarballRef | undefined>,
): Promise<PackageStoreTarballRef | undefined> => {
  const ref = await pending
  if (ref !== undefined) return ref
  return scanPackageSpecs(scan, packageSpecs, index + 1)
}

const scanPackageSpecs = async (
  scan: RegistryScan,
  packageSpecs: readonly ParsedPackageSpec[],
  index: number,
): Promise<PackageStoreTarballRef | undefined> => {
  if (index === packageSpecs.length) return undefined
  return refOrContinueScan(scan, packageSpecs, index, tarballRefForSpec(scan, packageSpecs[index]))
}

const requiredTarballRef = (
  ref: PackageStoreTarballRef | undefined,
  packageSpecs: readonly ParsedPackageSpec[],
): PackageStoreTarballRef => {
  if (ref === undefined) {
    throw new PackageNotFoundError({ packageName: nameOf(packageSpecs) })
  }
  return ref
}

async function resolveTarballRef(
  packageSpecs: readonly ParsedPackageSpec[],
  options: PackageStoreOptions = {},
): Promise<PackageStoreTarballRef> {
  const baseUrl = registryBaseUrl(options)
  const scan: RegistryScan = {
    baseUrl,
    options,
    packument: await packumentFor(baseUrl, packageSpecs, options),
  }
  return requiredTarballRef(await scanPackageSpecs(scan, packageSpecs, 0), packageSpecs)
}

async function fetchTarball(tarballUrl: string): Promise<Uint8Array> {
  const buffer = await fetch(tarballUrl).then((r) => r.arrayBuffer())
  return new Uint8Array(buffer)
}
