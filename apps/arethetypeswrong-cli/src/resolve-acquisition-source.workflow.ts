import { type ParsedPackageSpec, ParsedPackageSpecSchema } from '@systemfsoftware/arethetypeswrong'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array, Match, Option, Predicate, Result } from 'effect'
import * as S from 'effect/Schema'

const acceptedSpecShape = 'Expected `pkg`, `pkg@1.2.3`, `pkg@^1.2.3`, `pkg@next`, or `@scope/pkg`.'

const directoryWithoutPackRecovery =
  'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.'

const refusedCodeUnits: readonly number[] = [...Array.range(0x00, 0x1f), 0x7f]

const containsControlCharacter = (raw: string): boolean =>
  Option.isSome(
    Array.findFirst(
      Array.makeBy(raw.length, (index) => raw.charCodeAt(index)),
      (code) => Array.contains(refusedCodeUnits, code),
    ),
  )

const maximumSpecLength = 214

const AcquisitionSourceDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/AcquisitionSourceDecision',
)
type AcquisitionSourceDecisionTypeId = typeof AcquisitionSourceDecisionTypeId

export class InvalidPackageSpec extends S.TaggedError<InvalidPackageSpec>()('InvalidPackageSpec', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [AcquisitionSourceDecisionTypeId] = AcquisitionSourceDecisionTypeId
}

export class TargetNotPackable extends S.TaggedError<TargetNotPackable>()('TargetNotPackable', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [AcquisitionSourceDecisionTypeId] = AcquisitionSourceDecisionTypeId
}

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
    test: (raw) => ['?', '#'].some((marker) => raw.includes(marker)),
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

const isTagVersionKind = (spec: ParsedPackageSpec): boolean => spec.versionKind === 'tag'

const isDistTagVersion = (spec: ParsedPackageSpec): boolean => distTag.test(spec.version)

const parsedSpecRefinements: readonly Refinement<ParsedPackageSpec>[] = [
  {
    test: Predicate.and(isTagVersionKind, Predicate.not(isDistTagVersion)),
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

const targetNotPackable = (): TargetNotPackable =>
  new TargetNotPackable({
    message: 'The target is not a package tarball this tool can read.',
    recovery: directoryWithoutPackRecovery,
  })

const isBarePackageName = (target: string): boolean => /^[a-z@][^/]*$/.test(target)

export class ResolveAcquisitionSourceCommand extends S.Class<ResolveAcquisitionSourceCommand>(
  'ResolveAcquisitionSourceCommand',
)({
  target: S.String,
  fromNpm: S.Boolean,
  parsed: S.Option(ParsedPackageSpecSchema),
}) {}

const registrySpecDecision = (
  command: ResolveAcquisitionSourceCommand,
): Result.Result<AcquisitionSourceDecision, InvalidPackageSpec> =>
  Option.match(findRefusal(specRefinements, command.target), {
    onSome: (refusal) => Result.fail(refusal),
    onNone: () =>
      Option.match(command.parsed, {
        onNone: () => Result.fail(unparseableSpec()),
        onSome: (spec) => Result.map(refineParsedSpec(spec), (parsed) => new RegistryPackage({ spec: parsed })),
      }),
  })

export class ExistingTarball extends S.TaggedClass<ExistingTarball>()('ExistingTarball', {}) {
  readonly [AcquisitionSourceDecisionTypeId] = AcquisitionSourceDecisionTypeId
}

export class RegistryPackage extends S.TaggedClass<RegistryPackage>()('RegistryPackage', {
  spec: ParsedPackageSpecSchema,
}) {
  readonly [AcquisitionSourceDecisionTypeId] = AcquisitionSourceDecisionTypeId
}

export type AcquisitionSourceDecision = ExistingTarball | RegistryPackage

const tarballSuffixSchema = S.Literals(['.tar.gz', '.tgz', 'other'])

type TarballSuffix = S.Schema.Type<typeof tarballSuffixSchema>

const tarballSuffix = (target: string): TarballSuffix =>
  Match.value(target.endsWith('.tgz')).pipe(
    Match.when(true, (): TarballSuffix => '.tgz'),
    Match.when(false, (): TarballSuffix =>
      Match.value(target.endsWith('.tar.gz')).pipe(
        Match.when(true, (): TarballSuffix => '.tar.gz'),
        Match.when(false, (): TarballSuffix => 'other'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const targetShapeSchema = S.Literals(['existingTarball', 'notPackable', 'registryPackage'])

type TargetShape = S.Schema.Type<typeof targetShapeSchema>

const targetShape = (command: ResolveAcquisitionSourceCommand): TargetShape =>
  Match.value(tarballSuffix(command.target)).pipe(
    Match.when('.tgz', (): TargetShape => 'existingTarball'),
    Match.when('.tar.gz', (): TargetShape => 'existingTarball'),
    Match.when('other', (): TargetShape =>
      Match.value(command.fromNpm).pipe(
        Match.when(true, (): TargetShape => 'registryPackage'),
        Match.when(false, (): TargetShape =>
          Match.value(isBarePackageName(command.target)).pipe(
            Match.when(true, (): TargetShape => 'registryPackage'),
            Match.when(false, (): TargetShape => 'notPackable'),
            Match.exhaustive,
          )),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

export const resolveAcquisitionSource = Workflow.make(
  ResolveAcquisitionSourceCommand,
  (command): Result.Result<AcquisitionSourceDecision, InvalidPackageSpec | TargetNotPackable> =>
    Match.value(targetShape(command)).pipe(
      Match.when('existingTarball', () => Result.succeed(new ExistingTarball())),
      Match.when('registryPackage', () => registrySpecDecision(command)),
      Match.when('notPackable', () => Result.fail(targetNotPackable())),
      Match.exhaustive,
    ),
)
