import { it } from '@effect/vitest'
import { type ParsedPackageSpec, ParsedPackageSpecSchema, parsePackageSpec } from '@systemfsoftware/arethetypeswrong'
import { Match, Option, Predicate, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  buildManifestUrl,
  decodePayloadSize,
  decodeRegistryUrl,
  type PayloadKind,
  payloadLimit,
} from '../RegistryUrl.js'
import { resolveAcquisitionSource, ResolveAcquisitionSourceCommand } from '../resolve-acquisition-source.workflow.js'

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
  .map(([head, tail]) => `${head}${tail.join('')}x`)

const codeUnitCharacter = (max: number): fc.Arbitrary<string> =>
  fc.oneof(fc.integer({ min: 0, max }), fc.constant(0x7f)).map((code) => String.fromCharCode(code))

const urlSyntaxCharacter = fc.stringMatching(/^[?#%]$/)
const urlSyntaxOrControlCharacter = fc.oneof(urlSyntaxCharacter, codeUnitCharacter(0x1f))

const forbiddenSpec = fc
  .tuple(
    nameHead,
    fc.array(nameTail, { maxLength: 12 }),
    urlSyntaxOrControlCharacter,
    fc.array(nameTail, { maxLength: 12 }),
  )
  .map(([head, prefix, character, suffix]) => `${head}${prefix.join('')}${suffix.join('')}${character}`)

const weldedSpec = fc.oneof(
  fc.constant('pkg?fields=name'),
  fc
    .tuple(fc.array(nameTail, { maxLength: 10 }), fc.constantFrom('?fields=name', '#fragment', '?a=1&b=2'))
    .map(([prefix, welded]) => `p${prefix.join('')}kg${welded}`),
)

const unversionedScopedSpec = fc.oneof(
  fc.constant('@scope/name'),
  bareName.map((name) => `@${name}/${name}`),
)

const tarballTarget: fc.Arbitrary<string> = fc
  .tuple(bareName, fc.constantFrom('.tgz', '.tar.gz'))
  .map(([name, suffix]) => `${name}${suffix}`)

const parsedSpec: fc.Arbitrary<ParsedPackageSpec> = Schema.toArbitrary(ParsedPackageSpecSchema)(fc)

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

const parsedSpecOf = (target: string): Option.Option<ParsedPackageSpec> =>
  Result.match(parsePackageSpec(target), {
    onFailure: () => Option.none(),
    onSuccess: (spec) => Option.some(spec),
  })

const specDecision = (target: string, fromNpm: boolean) =>
  resolveAcquisitionSource(new ResolveAcquisitionSourceCommand({ target, fromNpm, parsed: parsedSpecOf(target) }))

it.prop('∀spec_RefusedCharacter_⊥Accepted', [forbiddenSpec], ([raw]) =>
  Result.match(specDecision(raw, false), {
    onFailure: (failure) => Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.length > 0,
    onSuccess: () => false,
  }))

it.prop('∀spec_OverlengthSpec_⊥Accepted', [overlengthSpec], ([raw]) =>
  Result.match(specDecision(raw, false), {
    onFailure: (failure) =>
      Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.includes('@scope/pkg'),
    onSuccess: () => false,
  }))

it.prop('∀spec_WeldedQuery_⊥Accepted', [weldedSpec], ([raw]) =>
  Result.match(specDecision(raw, false), {
    onFailure: (failure) =>
      Predicate.isTagged(failure, 'InvalidPackageSpec') && failure.recovery.includes('@scope/pkg'),
    onSuccess: () => false,
  }))

it.prop(
  '∀parts_DecodePackageSpec_≡Input',
  [acceptedSpecParts],
  ([parts]) =>
    Result.match(specDecision(`${parts.name}@${parts.version}`, true), {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('RegistryPackage', ({ spec }) => spec.name === parts.name && spec.version === parts.version),
          Match.tag('ExistingTarball', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    }),
)

it.prop('∀parts_ScopedSpec_≡ScopedInput', [scopedSpecParts], ([parts]) => {
  const scoped = `@${parts.name}/${parts.name}`
  return Result.match(specDecision(`${scoped}@${parts.version}`, true), {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RegistryPackage', ({ spec }) => spec.name === scoped && spec.version === parts.version),
        Match.tag('ExistingTarball', () => false),
        Match.exhaustive,
      ),
    onFailure: () => false,
  })
})

it.prop('∀spec_UnversionedScoped_=Latest', [unversionedScopedSpec], ([raw]) =>
  Result.match(specDecision(raw, true), {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RegistryPackage', ({ spec }) =>
          spec.versionKind === 'none' &&
          buildManifestUrl(registryBase, spec).endsWith(`/${encodeURIComponent(raw)}/${defaultTag}`)),
        Match.tag('ExistingTarball', () => false),
        Match.exhaustive,
      ),
    onFailure: () => false,
  }))

it.prop(
  '∀target_TarballTarget_=ExistingTarball',
  [tarballTarget],
  ([target]) =>
    Result.match(specDecision(target, false), {
      onSuccess: (decision) => Predicate.isTagged(decision, 'ExistingTarball'),
      onFailure: () => false,
    }),
)

it.prop('∀target_PathTarget_⊥PacklessRead', [pathTarget], ([target]) =>
  Result.match(specDecision(target, false), {
    onFailure: (failure) => Predicate.isTagged(failure, 'TargetNotPackable') && failure.recovery.includes('pack'),
    onSuccess: () => false,
  }))

it.prop('∀spec_BuildManifestUrl_≡EncodedSegments', [parsedSpec], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  const segments = manifest.slice(registryBase.length + 1).split('/')
  const nameSegment = segments[0] ?? ''
  const versionSegment = segments[1] ?? ''
  const unversioned = spec.versionKind === 'none'
  return segments.length === 2 &&
    decodeURIComponent(nameSegment) === spec.name &&
    ((unversioned && versionSegment === defaultTag) ||
      (!unversioned && decodeURIComponent(versionSegment) === spec.version))
})

it.prop('∀spec_BuildManifestUrl_⊥RawMeta', [parsedSpec], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  return !manifest.includes('?') && !manifest.includes('#') && !manifest.includes(' ')
})

const verdaccioBase = fc.constantFrom(
  'http://localhost:4873',
  'http://localhost:4873/',
  'http://127.0.0.1:4873',
)

it.prop('∀url_VerdaccioBase_=NormalizedBase', [verdaccioBase], ([raw]) =>
  Result.match(decodeRegistryUrl(raw), {
    onSuccess: (base) => base === raw.replace(/\/$/, ''),
    onFailure: () => false,
  }))

it.prop(
  '∀host_RegistryUrl_⊥PublicPlaintext',
  [publicHostPort],
  ([{ host, chosenPort }]) => Result.isFailure(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host_LoopbackPrivate_⊥Refusal',
  [localHostPort],
  ([{ host, chosenPort }]) => Result.isSuccess(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host_RegistryUrl_=HttpsBase',
  [fc.oneof(publicHost, localHost)],
  ([host]) =>
    Result.match(decodeRegistryUrl(`https://${host}/`), {
      onSuccess: (base) => base === `https://${host}`,
      onFailure: () => false,
    }),
)

it.prop(
  '∀url_RegistryUrl_⊥Credentials',
  [credentialedUrl],
  ([raw]) => Result.isFailure(decodeRegistryUrl(raw)),
)

it.prop(
  '∀url_RegistryUrl_⊥NonHttpScheme',
  [nonHttpUrl],
  ([raw]) => Result.isFailure(decodeRegistryUrl(raw)),
)

it.prop(
  '∀url_RegistryUrl_⊥StrippedCharacter',
  [strippedUrl],
  ([raw]) => Result.isFailure(decodeRegistryUrl(raw)),
)

it.prop(
  '∀size_DecodePayloadSize_≤Limit',
  [payloadSize],
  ([{ kind, byteLength }]) =>
    Result.match(decodePayloadSize(kind, byteLength), {
      onSuccess: () => byteLength <= payloadLimit(kind),
      onFailure: (refusal) => byteLength > payloadLimit(kind) && refusal.recovery.length > 0,
    }),
)
