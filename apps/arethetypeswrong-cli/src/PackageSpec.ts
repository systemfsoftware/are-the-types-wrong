import {
  type PackageSpecVersionKind,
  type ParsedPackageSpec,
  parsePackageSpec,
} from '@systemfsoftware/arethetypeswrong'
import { Array, Option, Result } from 'effect'

import { InvalidPackageSpec, TargetNotPackable } from './Failure.schema.js'
import { directoryWithoutPackHint } from './Hints.js'

const acceptedSpecShape = 'Expected `pkg`, `pkg@1.2.3`, `pkg@^1.2.3`, `pkg@next`, or `@scope/pkg`.'

const refusedCodeUnits: readonly number[] = [...Array.range(0x00, 0x1f), 0x7f]

const containsControlCharacter = (raw: string): boolean =>
  Option.isSome(
    Array.findFirst(
      Array.makeBy(raw.length, (index) => raw.charCodeAt(index)),
      (code) => Array.contains(refusedCodeUnits, code),
    ),
  )

const maximumSpecLength = 214

const refuse = (message: string, fix: string): InvalidPackageSpec =>
  new InvalidPackageSpec({ message, recovery: `${fix} ${acceptedSpecShape}` })

interface Refinement<Input> {
  readonly test: (input: Input) => boolean
  readonly refusal: () => InvalidPackageSpec
}

const specRefinements: readonly Refinement<string>[] = [
  {
    test: (raw) => containsControlCharacter(raw),
    refusal: () =>
      refuse('The package spec contains an ASCII control character.', 'Remove it and rerun the same command.'),
  },
  {
    test: (raw) => raw.includes('?') || raw.includes('#'),
    refusal: () =>
      refuse(
        'The package spec contains a URL query or fragment marker.',
        'Drop the URL syntax and rerun the same command.',
      ),
  },
  {
    test: (raw) => raw.includes('%'),
    refusal: () =>
      refuse(
        'The package spec contains percent-encoding.',
        'Write the name literally and rerun the same command.',
      ),
  },
  {
    test: (raw) => raw.length > maximumSpecLength,
    refusal: () =>
      refuse(
        `The package spec is longer than ${maximumSpecLength} characters.`,
        'Shorten it and rerun the same command.',
      ),
  },
]

const distTag = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const parsedSpecRefinements: readonly Refinement<ParsedPackageSpec>[] = [
  {
    test: (spec) => spec.versionKind === 'tag' && !distTag.test(spec.version),
    refusal: () =>
      refuse(
        'The version in the package spec is neither an exact version, a range, nor a dist-tag.',
        'Pass an exact version, a range, or a published tag, and rerun the same command.',
      ),
  },
]

const findRefusal = <Input>(
  refinements: readonly Refinement<Input>[],
  input: Input,
): Option.Option<InvalidPackageSpec> =>
  Option.map(
    Array.findFirst(refinements, (refinement) => refinement.test(input)),
    (refinement) => refinement.refusal(),
  )

const unparseableSpec = (): InvalidPackageSpec =>
  refuse('The package spec is not a package name npm accepts.', 'Correct the package spec and rerun the same command.')

const refineParsedSpec = (spec: ParsedPackageSpec): Result.Result<ParsedPackageSpec, InvalidPackageSpec> =>
  Option.match(findRefusal(parsedSpecRefinements, spec), {
    onNone: () => Result.succeed(spec),
    onSome: (refusal) => Result.fail(refusal),
  })

export const decodePackageSpec = (raw: string): Result.Result<ParsedPackageSpec, InvalidPackageSpec> =>
  Option.match(findRefusal(specRefinements, raw), {
    onNone: () => Result.flatMap(Result.mapError(parsePackageSpec(raw), unparseableSpec), refineParsedSpec),
    onSome: (refusal) => Result.fail(refusal),
  })

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

export type TargetShape = 'npm' | 'tarball'

const isTarballTarget = (target: string): boolean => target.endsWith('.tgz') || target.endsWith('.tar.gz')

const isBarePackageName = (target: string): boolean => /^[a-z@][^/]*$/.test(target)

interface TargetRule {
  readonly test: (target: string, fromNpm: boolean) => boolean
  readonly shape: TargetShape
}

const targetRules: readonly TargetRule[] = [
  { test: (target) => isTarballTarget(target), shape: 'tarball' },
  { test: (target, fromNpm) => fromNpm || isBarePackageName(target), shape: 'npm' },
]

/**
 * One refusal for every target that is neither a tarball nor a package name: a
 * directory reaches this arm only because `--pack` was not passed, and reading
 * it would answer `EISDIR` — an errno, not a diagnosis.
 */
export const targetNotPackable = (): TargetNotPackable =>
  new TargetNotPackable({
    message: 'The target is not a package tarball this tool can read.',
    recovery: directoryWithoutPackHint.text,
  })

export const decodeTargetShape = (
  target: string,
  options: { readonly fromNpm: boolean },
): Result.Result<TargetShape, TargetNotPackable> =>
  Option.match(
    Option.map(
      Array.findFirst(targetRules, (rule) => rule.test(target, options.fromNpm)),
      (rule) => rule.shape,
    ),
    { onNone: () => Result.fail(targetNotPackable()), onSome: (shape) => Result.succeed(shape) },
  )
