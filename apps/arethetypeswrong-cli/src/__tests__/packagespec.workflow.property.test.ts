import { it } from '@effect/vitest'
import { ParsedPackageSpecSchema } from '@systemfsoftware/arethetypeswrong'
import { Effect, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { buildManifestUrl, decodePackageSpec, decodeTargetShape } from '../PackageSpec.js'
import { decodePayloadSize, decodeRegistryUrl, type PayloadKind, payloadLimit } from '../RegistryUrl.js'

const registryBase = 'https://registry.npmjs.org'
const defaultTag = 'latest'

const nameHead = fc.stringMatching(/^[a-z]$/)
const nameTail = fc.stringMatching(/^[a-z0-9._-]$/)

const bareName: fc.Arbitrary<string> = fc
  .tuple(nameHead, fc.array(nameTail, { maxLength: 24 }))
  .map(([head, tail]) => head + tail.join(''))

const packageName: fc.Arbitrary<string> = fc.oneof(bareName, bareName.map((name) => `@${name}/${name}`))

const versionPart = fc.integer({ min: 0, max: 999 })
const exactVersion = fc.tuple(versionPart, versionPart, versionPart).map(
  ([major, minor, patch]) => `${major}.${minor}.${patch}`,
)
const rangeVersion = fc
  .tuple(fc.constantFrom('^', '~', '>='), exactVersion)
  .map(([operator, version]) => `${operator}${version}`)
const distTag = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/)
const versionArm = fc.oneof(fc.constant(''), exactVersion, rangeVersion, distTag)

const acceptedSpecParts = fc.record({ name: packageName, version: versionArm })
const scopedSpecParts = fc.record({ name: bareName, version: versionArm })

const overlengthSpec = fc
  .tuple(nameHead, fc.array(nameTail, { minLength: 214, maxLength: 299 }))
  .map(([head, tail]) => head + tail.join(''))

const codeUnitCharacter = (max: number): fc.Arbitrary<string> =>
  fc.oneof(fc.integer({ min: 0, max }), fc.constant(0x7f)).map((code) => String.fromCharCode(code))

const urlSyntaxCharacter = fc.stringMatching(/^[?#%]$/)
const urlSyntaxOrControlCharacter = fc.oneof(urlSyntaxCharacter, codeUnitCharacter(0x1f))

const forbiddenSpec = fc
  .tuple(
    fc.array(nameTail, { maxLength: 12 }),
    urlSyntaxOrControlCharacter,
    fc.array(nameTail, { maxLength: 12 }),
  )
  .map(([head, character, tail]) => head.join('') + character + tail.join(''))

const weldedSpec = fc.oneof(
  fc.constant('pkg?fields=name'),
  fc
    .tuple(fc.array(nameTail, { maxLength: 10 }), fc.constantFrom('?fields=name', '#fragment', '?a=1&b=2'))
    .map(([prefix, welded]) => `${prefix.join('')}pkg${welded}`),
)

const unversionedScopedSpec = fc.oneof(
  fc.constant('@scope/name'),
  bareName.map((name) => `@${name}/${name}`),
)

const octet = fc.integer({ min: 0, max: 255 })
const publicFirstOctet = fc.oneof(
  fc.integer({ min: 0, max: 9 }),
  fc.integer({ min: 11, max: 126 }),
  fc.integer({ min: 128, max: 255 }),
)
const publicSecondOctet = fc.oneof(
  fc.integer({ min: 0, max: 15 }),
  fc.integer({ min: 32, max: 167 }),
  fc.integer({ min: 169, max: 255 }),
)
const publicIpv4 = fc
  .tuple(publicFirstOctet, publicSecondOctet, octet, octet)
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)
const hostnameLabel = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)
const publicHostname = fc
  .tuple(hostnameLabel, fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,8}$/))
  .map(([label, suffix]) => `${label}.${suffix}`)
const loopbackShapedHostname = fc
  .tuple(fc.constantFrom('127.0.0.1', 'localhost'), hostnameLabel)
  .map(([prefix, label]) => `${prefix}.${label}.example.com`)
const publicHost = fc.oneof(publicIpv4, publicHostname, loopbackShapedHostname)

const loopbackIpv4 = fc.tuple(octet, octet, octet).map(([b, c, d]) => `127.${b}.${c}.${d}`)
const privateClassA = fc.tuple(octet, octet, octet).map(([b, c, d]) => `10.${b}.${c}.${d}`)
const privateClassB = fc
  .tuple(fc.integer({ min: 16, max: 31 }), octet, octet)
  .map(([b, c, d]) => `172.${b}.${c}.${d}`)
const privateClassC = fc.tuple(octet, octet).map(([c, d]) => `192.168.${c}.${d}`)
const localHost = fc.oneof(
  fc.constant('localhost'),
  fc.constant('[::1]'),
  loopbackIpv4,
  privateClassA,
  privateClassB,
  privateClassC,
)

const port = fc.integer({ min: 1024, max: 65_535 })
const publicHostPort = fc.record({ host: publicHost, chosenPort: port })
const localHostPort = fc.record({ host: localHost, chosenPort: port })

const credentialLabel = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/)
const credentials = fc.oneof(
  credentialLabel,
  fc.tuple(credentialLabel, credentialLabel).map(([user, password]) => `${user}:${password}`),
)
const credentialedUrl = fc
  .tuple(fc.constantFrom('https', 'http'), credentials, fc.oneof(publicHost, localHost))
  .map(([scheme, credential, host]) => `${scheme}://${credential}@${host}/`)

const nonHttpScheme = fc.stringMatching(/^x[a-z]{1,4}$/)
const nonHttpUrl = fc
  .tuple(nonHttpScheme, fc.oneof(publicHost, localHost))
  .map(([scheme, host]) => `${scheme}://${host}/`)

const strippedUrl = fc
  .tuple(fc.constantFrom('https', 'http'), fc.oneof(publicHost, localHost), codeUnitCharacter(0x20))
  .map(([scheme, host, character]) => `${scheme}://${host}/${character}`)

const pathUnit = fc.stringMatching(/^[a-z0-9_/-]$/)
const pathTarget = fc.oneof(
  fc.constant('.'),
  fc.constant('..'),
  fc.array(pathUnit, { minLength: 1, maxLength: 12 }).map((units) => `./${units.join('')}`),
  fc.array(pathUnit, { minLength: 1, maxLength: 12 }).map((units) => `/${units.join('')}`),
)

const withinRegistryDocumentLimit = fc.integer({ min: 0, max: 8_388_608 })
const betweenPayloadLimits = fc.integer({ min: 8_388_609, max: 536_870_912 })
const beyondTarballLimit = fc.integer({ min: 536_870_913, max: 2_147_483_647 })

const payloadSize = fc.record({
  kind: fc.constantFrom<PayloadKind>('registry-document', 'tarball'),
  byteLength: fc.oneof(withinRegistryDocumentLimit, betweenPayloadLimits, beyondTarballLimit),
})

it.effect.prop('∀spec_RefusedCharacter_⊥Accepted', [forbiddenSpec], ([raw]) =>
  Effect.succeed(
    Result.match(decodePackageSpec(raw), {
      onFailure: (failure) => Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.length > 0,
      onSuccess: () => false,
    }),
  ))

it.effect.prop('∀spec_OverlengthSpec_⊥Accepted', [overlengthSpec], ([raw]) =>
  Effect.succeed(
    Result.match(decodePackageSpec(raw), {
      onFailure: (failure) =>
        Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.includes('@scope/pkg'),
      onSuccess: () => false,
    }),
  ))

it.effect.prop('∀spec_WeldedQuery_⊥Accepted', [weldedSpec], ([raw]) =>
  Effect.succeed(
    Result.match(decodePackageSpec(raw), {
      onFailure: (failure) =>
        Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.includes('@scope/pkg'),
      onSuccess: () => false,
    }),
  ))

it.effect.prop('∀parts_DecodePackageSpec_≡Input', [acceptedSpecParts], ([parts]) =>
  Effect.succeed(
    Result.match(decodePackageSpec(`${parts.name}@${parts.version}`), {
      onSuccess: (spec) => spec.name === parts.name && spec.version === parts.version,
      onFailure: () => false,
    }),
  ))

it.effect.prop('∀parts_ScopedSpec_≡ScopedInput', [scopedSpecParts], ([parts]) => {
  const scoped = `@${parts.name}/${parts.name}`
  return Effect.succeed(
    Result.match(decodePackageSpec(`${scoped}@${parts.version}`), {
      onSuccess: (spec) => spec.name === scoped && spec.version === parts.version,
      onFailure: () => false,
    }),
  )
})

it.effect.prop('∀spec_UnversionedScoped_=Latest', [unversionedScopedSpec], ([raw]) =>
  Effect.succeed(
    Result.match(decodePackageSpec(raw), {
      onSuccess: (spec) =>
        spec.versionKind === 'none' &&
        buildManifestUrl(registryBase, spec).endsWith(`/${encodeURIComponent(raw)}/${defaultTag}`),
      onFailure: () => false,
    }),
  ))

it.effect.prop('∀spec_BuildManifestUrl_≡EncodedSegments', [ParsedPackageSpecSchema], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  const segments = manifest.slice(registryBase.length + 1).split('/')
  const nameSegment = segments[0] ?? ''
  const versionSegment = segments[1] ?? ''
  const unversioned = spec.versionKind === 'none'
  return Effect.succeed(
    segments.length === 2 &&
      decodeURIComponent(nameSegment) === spec.name &&
      ((unversioned && versionSegment === defaultTag) ||
        (!unversioned && decodeURIComponent(versionSegment) === spec.version)),
  )
})

it.effect.prop('∀spec_BuildManifestUrl_⊥RawMeta', [ParsedPackageSpecSchema], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  return Effect.succeed(
    !manifest.includes('?') && !manifest.includes('#') && !manifest.includes(' '),
  )
})

const verdaccioBase = fc.constantFrom(
  'http://localhost:4873',
  'http://localhost:4873/',
  'http://127.0.0.1:4873',
)

it.effect.prop('∀url_VerdaccioBase_=NormalizedBase', [verdaccioBase], ([raw]) =>
  Effect.succeed(
    Result.match(decodeRegistryUrl(raw), {
      onSuccess: (base) => base === raw.replace(/\/$/, ''),
      onFailure: () => false,
    }),
  ))

it.effect.prop(
  '∀host_RegistryUrl_⊥PublicPlaintext',
  [publicHostPort],
  ([{ host, chosenPort }]) => Effect.succeed(Result.isFailure(decodeRegistryUrl(`http://${host}:${chosenPort}/`))),
)

it.effect.prop(
  '∀host_LoopbackPrivate_⊥Refusal',
  [localHostPort],
  ([{ host, chosenPort }]) => Effect.succeed(Result.isSuccess(decodeRegistryUrl(`http://${host}:${chosenPort}/`))),
)

it.effect.prop('∀host_RegistryUrl_=HttpsBase', [fc.oneof(publicHost, localHost)], ([host]) =>
  Effect.succeed(
    Result.match(decodeRegistryUrl(`https://${host}/`), {
      onSuccess: (base) => base === `https://${host}`,
      onFailure: () => false,
    }),
  ))

it.effect.prop(
  '∀url_RegistryUrl_⊥Credentials',
  [credentialedUrl],
  ([raw]) => Effect.succeed(Result.isFailure(decodeRegistryUrl(raw))),
)

it.effect.prop(
  '∀url_RegistryUrl_⊥NonHttpScheme',
  [nonHttpUrl],
  ([raw]) => Effect.succeed(Result.isFailure(decodeRegistryUrl(raw))),
)

it.effect.prop(
  '∀url_RegistryUrl_⊥StrippedCharacter',
  [strippedUrl],
  ([raw]) => Effect.succeed(Result.isFailure(decodeRegistryUrl(raw))),
)

it.effect.prop('∀target_PathTarget_⊥PacklessRead', [pathTarget], ([target]) =>
  Effect.succeed(
    Result.match(decodeTargetShape(target, { fromNpm: false }), {
      onFailure: (failure) => Predicate.isTagged(failure, 'TargetNotPackable') && failure.recovery.includes('pack'),
      onSuccess: () => false,
    }),
  ))

it.effect.prop('∀size_DecodePayloadSize_≤Limit', [payloadSize], ([{ kind, byteLength }]) =>
  Effect.succeed(
    Result.match(decodePayloadSize(kind, byteLength), {
      onSuccess: () => byteLength <= payloadLimit(kind),
      onFailure: (refusal) => byteLength > payloadLimit(kind) && refusal.recovery.length > 0,
    }),
  ))
