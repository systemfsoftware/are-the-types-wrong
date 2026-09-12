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

type Disposition = 'registryPackage' | 'existingTarball' | 'targetNotPackable' | 'invalidSpec'

interface SpecRow {
  readonly target: string
  readonly fromNpm: boolean
  readonly expected: Disposition
  readonly name?: string
  readonly version?: string
}

const longName = (length: number): string => 'a'.repeat(length)

const specDispositionTable: readonly SpecRow[] = [
  { target: 'demo', fromNpm: true, expected: 'registryPackage', name: 'demo' },
  { target: 'demo', fromNpm: false, expected: 'registryPackage', name: 'demo' },
  { target: 'demo@1.2.3', fromNpm: true, expected: 'registryPackage', name: 'demo', version: '1.2.3' },
  { target: 'demo@^1.2.3', fromNpm: true, expected: 'registryPackage', name: 'demo', version: '^1.2.3' },
  { target: 'demo@next', fromNpm: true, expected: 'registryPackage', name: 'demo', version: 'next' },
  { target: '@scope/demo', fromNpm: true, expected: 'registryPackage', name: '@scope/demo' },
  {
    target: '@scope/demo@1.2.3',
    fromNpm: true,
    expected: 'registryPackage',
    name: '@scope/demo',
    version: '1.2.3',
  },
  { target: 'demo.tgz', fromNpm: false, expected: 'existingTarball' },
  { target: 'demo.tgz', fromNpm: true, expected: 'existingTarball' },
  { target: 'demo.tar.gz', fromNpm: false, expected: 'existingTarball' },
  { target: './demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '../demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '/abs/demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '.', fromNpm: false, expected: 'targetNotPackable' },
  { target: './demo', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo?fields=name', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo#fragment', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo%20name', fromNpm: true, expected: 'invalidSpec' },
  { target: `demo${String.fromCharCode(7)}`, fromNpm: true, expected: 'invalidSpec' },
  { target: `demo${String.fromCharCode(0x7f)}`, fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo@next!', fromNpm: true, expected: 'invalidSpec' },
  { target: longName(213), fromNpm: true, expected: 'registryPackage', name: longName(213) },
  { target: longName(214), fromNpm: true, expected: 'registryPackage', name: longName(214) },
  { target: longName(215), fromNpm: true, expected: 'invalidSpec' },
]

const parsedSpecOf = (target: string): Option.Option<ParsedPackageSpec> =>
  Result.match(parsePackageSpec(target), {
    onFailure: () => Option.none(),
    onSuccess: (spec) => Option.some(spec),
  })

const decisionOf = (target: string, fromNpm: boolean) =>
  resolveAcquisitionSource(new ResolveAcquisitionSourceCommand({ target, fromNpm, parsed: parsedSpecOf(target) }))

const holdsSpecRow = (row: SpecRow): boolean =>
  Result.match(decisionOf(row.target, row.fromNpm), {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('ExistingTarball', () => row.expected === 'existingTarball'),
        Match.tag('RegistryPackage', ({ spec }) =>
          row.expected === 'registryPackage' &&
          (row.name === undefined || spec.name === row.name) &&
          (row.version === undefined || spec.version === row.version)),
        Match.exhaustive,
      ),
    onFailure: (refusal) =>
      Match.value(row.expected).pipe(
        Match.when(
          'invalidSpec',
          () => Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.recovery.length > 0,
        ),
        Match.when(
          'targetNotPackable',
          () => Predicate.isTagged(refusal, 'TargetNotPackable') && refusal.recovery.includes('pack'),
        ),
        Match.orElse(() => false),
      ),
  })

const nameHead = fc.stringMatching(/^[a-z]$/)
const nameTail = fc.stringMatching(/^[a-z0-9._-]$/)

const bareName: fc.Arbitrary<string> = fc
  .tuple(nameHead, fc.array(nameTail, { maxLength: 24 }))
  .map(([head, tail]) => head + tail.join(''))

const overlengthName: fc.Arbitrary<string> = fc
  .tuple(nameHead, fc.array(nameTail, { minLength: 214, maxLength: 299 }))
  .map(([head, tail]) => `${head}${tail.join('')}`)

const weldedSpec: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('demo?fields=name', 'demo#fragment', 'demo?a=1&b=2'),
  fc
    .tuple(fc.array(nameTail, { maxLength: 10 }), fc.constantFrom('?fields=name', '#fragment', '?a=1&b=2'))
    .map(([prefix, welded]) => `p${prefix.join('')}kg${welded}`),
)

const codeUnit = fc.integer({ min: 0, max: 0xff })

interface InjectedCodeUnit {
  readonly target: string
  readonly code: number
}

const injectedCodeUnit: fc.Arbitrary<InjectedCodeUnit> = fc
  .tuple(bareName, codeUnit)
  .map(([name, code]) => ({ target: `${name}${String.fromCharCode(code)}`, code }))

const authoredControlRefusal = (code: number): boolean => code <= 0x1f || code === 0x7f

const refusedAsControlCharacter = (target: string): boolean =>
  Result.match(decisionOf(target, true), {
    onSuccess: () => false,
    onFailure: (refusal) => refusal.message.includes('control character'),
  })

type UrlDisposition = 'accepted' | 'refused'

const registryUrlTable: ReadonlyArray<{ readonly raw: string; readonly expected: UrlDisposition }> = [
  { raw: 'https://registry.npmjs.org', expected: 'accepted' },
  { raw: 'https://registry.npmjs.org/', expected: 'accepted' },
  { raw: 'https://registry.example.com:8443', expected: 'accepted' },
  { raw: 'http://localhost:4873', expected: 'accepted' },
  { raw: 'http://127.0.0.1:4873', expected: 'accepted' },
  { raw: 'http://127.0.0.53:4873', expected: 'accepted' },
  { raw: 'http://[::1]:4873', expected: 'accepted' },
  { raw: 'http://10.1.2.3:4873', expected: 'accepted' },
  { raw: 'http://192.168.1.10:4873', expected: 'accepted' },
  { raw: 'http://172.16.0.1:4873', expected: 'accepted' },
  { raw: 'http://registry.npmjs.org', expected: 'refused' },
  { raw: 'http://93.184.216.34:4873', expected: 'refused' },
  { raw: 'http://public.example.com:4873', expected: 'refused' },
  { raw: 'http://user:pass@localhost:4873', expected: 'refused' },
  { raw: 'https://user@registry.npmjs.org', expected: 'refused' },
  { raw: 'ftp://localhost:4873', expected: 'refused' },
  { raw: 'http://127.0.0.1:4873/?scope=x', expected: 'refused' },
  { raw: 'http://127.0.0.1:4873/#fragment', expected: 'refused' },
  { raw: `http://127.0.0.1:4873/${String.fromCharCode(0x0a)}`, expected: 'refused' },
  { raw: 'not a url', expected: 'refused' },
]

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
const publicHostname = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,8}$/))
  .map(([label, suffix]) => `${label}.${suffix}`)
const publicHost = fc.oneof(publicIpv4, publicHostname)

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
const credentialedUrl = fc
  .tuple(
    fc.constantFrom('https', 'http'),
    fc.oneof(credentialLabel, fc.tuple(credentialLabel, credentialLabel).map(([user, pass]) => `${user}:${pass}`)),
    fc.oneof(publicHost, localHost),
  )
  .map(([scheme, credential, host]) => `${scheme}://${credential}@${host}/`)

const nonHttpScheme = fc.stringMatching(/^x[a-z]{1,4}$/)
const nonHttpUrl = fc
  .tuple(nonHttpScheme, fc.oneof(publicHost, localHost))
  .map(([scheme, host]) => `${scheme}://${host}/`)

const strippedCodeUnit = fc.oneof(fc.integer({ min: 0, max: 0x20 }), fc.constant(0x7f))
const strippedUrl = fc
  .tuple(fc.constantFrom('https', 'http'), fc.oneof(publicHost, localHost), strippedCodeUnit)
  .map(([scheme, host, code]) => `${scheme}://${host}/${String.fromCharCode(code)}`)

const registryDocumentLimit = 8_388_608
const tarballLimit = 536_870_912

interface PayloadRow {
  readonly kind: PayloadKind
  readonly byteLength: number
  readonly accepted: boolean
}

const payloadLimitTable: Readonly<Record<PayloadKind, number>> = {
  'registry-document': registryDocumentLimit,
  tarball: tarballLimit,
}

const payloadBoundaryTable: readonly PayloadRow[] = [
  { kind: 'registry-document', byteLength: 0, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit - 1, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit + 1, accepted: false },
  { kind: 'tarball', byteLength: tarballLimit - 1, accepted: true },
  { kind: 'tarball', byteLength: tarballLimit, accepted: true },
  { kind: 'tarball', byteLength: tarballLimit + 1, accepted: false },
]

const payloadSize: fc.Arbitrary<{ readonly kind: PayloadKind; readonly byteLength: number }> = fc.record({
  kind: fc.constantFrom<PayloadKind>('registry-document', 'tarball'),
  byteLength: fc.oneof(
    fc.integer({ min: 0, max: registryDocumentLimit }),
    fc.integer({ min: registryDocumentLimit + 1, max: tarballLimit }),
    fc.integer({ min: tarballLimit + 1, max: 2_147_483_647 }),
  ),
})

const parsedSpec: fc.Arbitrary<ParsedPackageSpec> = Schema.toArbitrary(ParsedPackageSpecSchema)(fc)

const holdsPayloadRow = (row: PayloadRow): boolean =>
  Result.match(decodePayloadSize(row.kind, row.byteLength), {
    onSuccess: (size) => row.accepted && row.byteLength <= payloadLimitTable[row.kind] && size === row.byteLength,
    onFailure: (refusal) => !row.accepted && refusal.recovery.length > 0,
  })

it.prop('∀row_SpecDisposition_=authoredTable', [fc.constantFrom(...specDispositionTable)], ([row]) => holdsSpecRow(row))

it.prop('∀target_OverlengthSpec_⊥Accepted', [overlengthName], ([name]) =>
  Result.match(decisionOf(name, true), {
    onFailure: (refusal) => Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.message.includes('214'),
    onSuccess: () => false,
  }))

it.prop('∀target_WeldedSpec_⊥Accepted', [weldedSpec], ([target]) =>
  Result.match(decisionOf(target, true), {
    onFailure: (refusal) =>
      Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.recovery.includes('@scope/pkg'),
    onSuccess: () => false,
  }))

it.prop(
  '∀target,code_ControlCharacterSpec_=authoredRefusal',
  [injectedCodeUnit],
  ([injected]) => refusedAsControlCharacter(injected.target) === authoredControlRefusal(injected.code),
)

it.prop(
  '∀row_RegistryUrlBoundary_=authoredDisposition',
  [fc.constantFrom(...registryUrlTable)],
  ([row]) =>
    Match.value(row.expected).pipe(
      Match.when('accepted', () => Result.isSuccess(decodeRegistryUrl(row.raw))),
      Match.when('refused', () => Result.isFailure(decodeRegistryUrl(row.raw))),
      Match.exhaustive,
    ),
)

it.prop(
  '∀host,port_HttpPublicHost_⊥RegistryUrl',
  [publicHostPort],
  ([{ host, chosenPort }]) => Result.isFailure(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host,port_LoopbackPrivateHost_⊥Refusal',
  [localHostPort],
  ([{ host, chosenPort }]) => Result.isSuccess(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host_HttpsHost_=HttpsBase',
  [fc.oneof(publicHost, localHost)],
  ([host]) =>
    Result.match(decodeRegistryUrl(`https://${host}/`), {
      onSuccess: (base) => base === `https://${host}`,
      onFailure: () => false,
    }),
)

it.prop('∀url_CredentialedUrl_⊥RegistryUrl', [credentialedUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀url_NonHttpScheme_⊥RegistryUrl', [nonHttpUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀url_StrippedCharacter_⊥RegistryUrl', [strippedUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀spec_ManifestUrl_≡EncodedSegments', [parsedSpec], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  const segments = manifest.slice(registryBase.length + 1).split('/')
  const nameSegment = segments[0] ?? ''
  const versionSegment = segments[1] ?? ''
  return segments.length === 2 &&
    decodeURIComponent(nameSegment) === spec.name &&
    Match.value(spec.versionKind === 'none').pipe(
      Match.when(true, () => versionSegment === defaultTag),
      Match.when(false, () => decodeURIComponent(versionSegment) === spec.version),
      Match.exhaustive,
    ) &&
    !manifest.includes('?') &&
    !manifest.includes('#') &&
    !manifest.includes(' ')
})

it.prop(
  '∀row_PayloadBoundary_=authoredLimit',
  [fc.constantFrom(...payloadBoundaryTable)],
  ([row]) => holdsPayloadRow(row),
)

it.prop(
  '∀kind,byteLength_PayloadSize_=authoredLimit',
  [payloadSize],
  ([{ kind, byteLength }]) =>
    payloadLimit(kind) === payloadLimitTable[kind] &&
    Result.match(decodePayloadSize(kind, byteLength), {
      onSuccess: (size) => byteLength <= payloadLimitTable[kind] && size === byteLength,
      onFailure: () => byteLength > payloadLimitTable[kind],
    }),
)
