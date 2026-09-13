import { Array, Option, Result } from 'effect'

import type { PackageSpecVersionKind, ParsedPackageSpec } from '@systemfsoftware/arethetypeswrong'

export interface RegistryUrlRefusal {
  readonly message: string
  readonly recovery: string
}

export type PayloadKind = 'registry-document' | 'tarball'

const refusal = (message: string, recovery: string): RegistryUrlRefusal => ({ message, recovery })

/**
 * C0 controls, space, and DEL. The URL parser strips the first group before it
 * parses, so `https://registry.npmjs.org\n` would parse as a clean URL and hide
 * the injected text.
 */
const strippedCodeUnits: readonly number[] = [...Array.range(0x00, 0x20), 0x7f]

const isStrippedCodeUnit = (code: number): boolean => Array.contains(strippedCodeUnits, code)

const containsStrippedCharacter = (raw: string): boolean =>
  Option.isSome(
    Array.findFirst(
      Array.makeBy(raw.length, (index) => raw.charCodeAt(index)),
      isStrippedCodeUnit,
    ),
  )

const reservedHosts: readonly string[] = ['localhost', '[::1]', '::1']
const loopbackIpv4 = /^127(?:\.\d{1,3}){3}$/
const privateIpv4 = /^(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/

const localHostRules: readonly ((hostname: string) => boolean)[] = [
  (hostname) => Array.contains(reservedHosts, hostname),
  (hostname) => loopbackIpv4.test(hostname),
  (hostname) => privateIpv4.test(hostname),
]

const isLocalHost = (hostname: string): boolean => Array.some(localHostRules, (rule) => rule(hostname))

const unparseableUrl = (): RegistryUrlRefusal =>
  refusal(
    'The registry URL is not a URL.',
    'Pass an absolute URL, e.g. `--registry https://registry.npmjs.org`.',
  )

const strippedUrl = (): RegistryUrlRefusal =>
  refusal(
    'The registry URL contains whitespace or a control character.',
    'Remove it and rerun the same command with `--registry https://registry.npmjs.org`.',
  )

interface UrlRule {
  readonly test: (url: URL) => boolean
  readonly refusal: () => RegistryUrlRefusal
}

const urlRules: readonly UrlRule[] = [
  {
    test: (url) => url.username.length > 0 || url.password.length > 0,
    refusal: () =>
      refusal(
        'The registry URL carries credentials.',
        'Remove the user and password from the URL; this tool sends no credentials.',
      ),
  },
  {
    test: (url) => url.protocol !== 'https:' && url.protocol !== 'http:',
    refusal: () =>
      refusal(
        'The registry URL is not an http or https URL.',
        'Pass an https URL, e.g. `--registry https://registry.npmjs.org`.',
      ),
  },
  {
    test: (url) => url.protocol === 'http:' && !isLocalHost(url.hostname),
    refusal: () =>
      refusal(
        'The registry URL sends plaintext HTTP to a remote host.',
        'Use https for a remote registry; http is accepted only for loopback and private-network hosts.',
      ),
  },
  {
    test: (url) => url.search.length > 0 || url.hash.length > 0,
    refusal: () =>
      refusal(
        'The registry URL carries a query or fragment.',
        'Pass the registry base URL with no query or fragment.',
      ),
  },
]

const parseRegistryUrl = (raw: string): Result.Result<URL, RegistryUrlRefusal> =>
  Option.match(
    Option.liftPredicate(raw, (text) => containsStrippedCharacter(text)).pipe(
      Option.map(strippedUrl),
    ),
    {
      onNone: () => Result.mapError(Result.try(() => new URL(raw)), unparseableUrl),
      onSome: (found) => Result.fail(found),
    },
  )

export const decodeRegistryUrl = (raw: string): Result.Result<string, RegistryUrlRefusal> =>
  Result.flatMap(parseRegistryUrl(raw), (url) =>
    Option.match(
      Option.map(
        Array.findFirst(urlRules, (rule) => rule.test(url)),
        (rule) => rule.refusal(),
      ),
      {
        onNone: () => Result.succeed(url.href.replace(/\/$/, '')),
        onSome: (found) => Result.fail(found),
      },
    ))

const defaultTagByKind: Readonly<Record<PackageSpecVersionKind, Option.Option<string>>> = {
  none: Option.some('latest'),
  exact: Option.none(),
  range: Option.none(),
  tag: Option.none(),
}

const requestedVersion = (spec: ParsedPackageSpec): string =>
  Option.getOrElse(defaultTagByKind[spec.versionKind], () => spec.version)

export const buildManifestUrl = (registryBase: string, spec: ParsedPackageSpec): string =>
  `${registryBase}/${encodeURIComponent(spec.name)}/${encodeURIComponent(requestedVersion(spec))}`

const payloadLimits: Readonly<Record<PayloadKind, number>> = {
  'registry-document': 8 * 1024 * 1024,
  tarball: 512 * 1024 * 1024,
}

const payloadLabels: Readonly<Record<PayloadKind, string>> = {
  'registry-document': 'registry document',
  tarball: 'package tarball',
}

export const payloadLimit = (kind: PayloadKind): number => payloadLimits[kind]

export const decodePayloadSize = (
  kind: PayloadKind,
  byteLength: number,
): Result.Result<number, RegistryUrlRefusal> => {
  const limit = payloadLimit(kind)
  if (byteLength > limit) {
    return Result.fail(
      refusal(
        `The ${payloadLabels[kind]} is larger than the ${limit} bytes this tool will read.`,
        'Analyze the package from a local tarball instead: download it and rerun with the .tgz path.',
      ),
    )
  }
  return Result.succeed(byteLength)
}
