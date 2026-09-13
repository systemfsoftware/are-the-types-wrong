import { it } from '@effect/vitest'
import { Match, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { CliInputSchema } from '../CliInput.schema.js'
import type { MachineEnvelope } from '../decode-envelope-document.workflow.js'
import { type Hint, type HintId, renderHints } from '../hint-shaping.js'
import { type EnvelopeMask, type EnvelopeMaskField, EnvelopeMaskFields } from '../Mask.js'
import {
  DecideHintsCommand,
  offerRecoveryHints,
  PacklessDirectoryHintsRequest,
  RunHintsRequest,
} from '../offer-recovery-hints.workflow.js'
import type { RenderMode } from '../select-render-mode.workflow.js'

const escape = String.fromCharCode(27)

const noFields: EnvelopeMask = {
  entrypoints: false,
  buildTools: false,
  programInfo: false,
  traces: false,
}

const allFields: EnvelopeMask = {
  entrypoints: true,
  buildTools: true,
  programInfo: true,
  traces: true,
}

const oneField: EnvelopeMask = { ...noFields, entrypoints: true }

const okDocument = (packageName: string): MachineEnvelope => ({
  status: 'ok',
  packageName,
  packageVersion: '1.0.0',
  types: { kind: 'included' },
  problems: [],
  problemCounts: {},
})

const untypedDocument = (packageName: string): MachineEnvelope => ({
  status: 'untyped',
  packageName,
  packageVersion: '1.0.0',
  types: false,
})

interface RunOverrides {
  readonly isTty?: boolean
  readonly mode?: RenderMode
  readonly include?: readonly string[]
  readonly mask?: EnvelopeMask
  readonly document?: MachineEnvelope
}

const run = (overrides: RunOverrides): DecideHintsCommand =>
  new DecideHintsCommand({
    request: new RunHintsRequest({
      document: overrides.document ?? okDocument('demo'),
      mode: overrides.mode ?? 'envelope',
      isTty: overrides.isTty ?? false,
      include: overrides.include ?? [],
      mask: overrides.mask ?? noFields,
    }),
  })

const packlessDirectory = new DecideHintsCommand({ request: new PacklessDirectoryHintsRequest({}) })

const noHints: readonly Hint[] = []

const hintsOf = (command: DecideHintsCommand): readonly Hint[] =>
  Match.value(Result.getOrThrow(offerRecoveryHints(command))).pipe(
    Match.tag('HintsOffered', ({ hints }) => hints),
    Match.tag('NoHintsApplicable', () => noHints),
    Match.exhaustive,
  )

const situationNames = [
  'tty',
  'quiet',
  'explicitTable',
  'untyped',
  'untypedWithInclude',
  'expansion',
  'partialMask',
  'includeGiven',
  'redundantInclude',
  'nothingOmitted',
  'directoryWithoutPack',
] as const

type Situation = typeof situationNames[number]

interface SituationSpec {
  readonly state: DecideHintsCommand
  readonly hints: readonly HintId[]
}

const situationTable: Readonly<Record<Situation, SituationSpec>> = {
  tty: { state: run({ isTty: true }), hints: [] },
  quiet: { state: run({ mode: 'quiet' }), hints: [] },
  explicitTable: { state: run({ mode: 'table' }), hints: [] },
  untyped: { state: run({ document: untypedDocument('demo') }), hints: ['untyped'] },
  untypedWithInclude: {
    state: run({ document: untypedDocument('demo'), include: ['entrypoints'] }),
    hints: ['untyped'],
  },
  expansion: { state: run({}), hints: ['expansion'] },
  partialMask: { state: run({ mask: oneField }), hints: ['expansion'] },
  includeGiven: { state: run({ include: ['entrypoints'] }), hints: [] },
  redundantInclude: { state: run({ include: [...EnvelopeMaskFields], mask: allFields }), hints: [] },
  nothingOmitted: { state: run({ mask: allFields }), hints: [] },
  directoryWithoutPack: { state: packlessDirectory, hints: ['directoryWithoutPack'] },
}

const expansionSituations = ['expansion', 'partialMask'] as const

const renderModes = ['envelope', 'table', 'table-flipped', 'ascii', 'quiet'] as const satisfies readonly RenderMode[]

const maskValue: fc.Arbitrary<EnvelopeMask> = fc.record({
  entrypoints: fc.boolean(),
  buildTools: fc.boolean(),
  programInfo: fc.boolean(),
  traces: fc.boolean(),
})

const includeTokens: fc.Arbitrary<string[]> = fc.array(fc.constantFrom(...EnvelopeMaskFields), { maxLength: 4 })

const hostileName: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(`${escape}[31m`, `${escape}[1;32m`, `${escape}]0;`),
    fc.stringMatching(/^[A-Za-z0-9@/._-]{1,12}$/),
    fc.constantFrom(`${escape}[0m`, `${escape}[K`, '\u0007'),
  )
  .map(([prefix, body, suffix]) => `${prefix}${body}${suffix}`)

interface HostileRunInputs {
  readonly packageName: string
  readonly untyped: boolean
  readonly mode: RenderMode
  readonly include: readonly string[]
  readonly mask: EnvelopeMask
}

const hostileRunInputs: fc.Arbitrary<HostileRunInputs> = fc.record({
  packageName: hostileName,
  untyped: fc.boolean(),
  mode: fc.constantFrom(...renderModes),
  include: includeTokens,
  mask: maskValue,
})

const documentNamed = (untyped: boolean, packageName: string): MachineEnvelope =>
  Match.value(untyped).pipe(
    Match.when(true, () => untypedDocument(packageName)),
    Match.when(false, () => okDocument(packageName)),
    Match.exhaustive,
  )

const runNamed = (inputs: HostileRunInputs, packageName: string): DecideHintsCommand =>
  run({
    document: documentNamed(inputs.untyped, packageName),
    mode: inputs.mode,
    include: inputs.include,
    mask: inputs.mask,
  })

const flagTokensIn = (text: string): readonly string[] =>
  [...text.matchAll(/--[a-z][a-z-]*/g)].map((match) => match[0].slice(2))

const nonFieldToken: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...EnvelopeMaskFields), fc.stringMatching(/^[A-Za-z0-9.-]{1,4}$/))
    .map(([field, suffix]) => `${field}${suffix}`),
  fc.constantFrom('table', 'json', 'ascii', '-f', ''),
)

const includeList: fc.Arbitrary<readonly EnvelopeMaskField[]> = fc.array(
  fc.constantFrom(...EnvelopeMaskFields),
  { maxLength: 4 },
)

const joinedTokens = (fields: readonly EnvelopeMaskField[]): readonly string[] =>
  Match.value(fields.length === 0).pipe(
    Match.when(true, () => []),
    Match.when(false, () => [fields.join(',')]),
    Match.exhaustive,
  )

it.prop('∀situation_Hints_=authoredTable', [fc.constantFrom(...situationNames)], ([situation]) => {
  const spec = situationTable[situation]
  const ids = hintsOf(spec.state).map((hint) => hint.id)
  return ids.length === spec.hints.length && ids.every((id, index) => id === spec.hints[index])
})

it.prop('∀inputs_Hints_=nameIndependent∧∌ESC', [hostileRunInputs], ([inputs]) => {
  const hostile = hintsOf(runNamed(inputs, inputs.packageName))
  const benign = hintsOf(runNamed(inputs, 'benign-package'))
  const rendered = renderHints(hostile)
  return hostile.length === benign.length &&
    hostile.every((hint, index) => hint.id === benign[index]?.id && hint.text === benign[index]?.text) &&
    hostile.every((hint) => !hint.text.includes(inputs.packageName)) &&
    !rendered.includes(inputs.packageName) &&
    !rendered.includes(escape)
})

it.prop(
  '∀situation_HintFlagTokens_∈CliInputSchema',
  [fc.constantFrom(...situationNames)],
  ([situation]) =>
    hintsOf(situationTable[situation].state).every((hint) =>
      flagTokensIn(hint.text).every((flag) => flag in CliInputSchema.fields)
    ),
)

it.prop(
  '∀situation_ExpansionHint_⊇EveryMaskField',
  [fc.constantFrom(...expansionSituations)],
  ([situation]) => {
    const texts = hintsOf(situationTable[situation].state).map((hint) => hint.text)
    return texts.some((text) => text.includes('--include')) &&
      EnvelopeMaskFields.every((field) => texts.some((text) => text.includes(field)))
  },
)

it.prop(
  '∀token_UnknownIncludeToken_⊥Hints',
  [nonFieldToken],
  ([token]) =>
    Result.match(offerRecoveryHints(run({ include: [token] })), {
      onFailure: (refusal) =>
        Predicate.isTagged(refusal, 'InvalidPackageSpec') &&
        EnvelopeMaskFields.every((field) => refusal.recovery.includes(field)),
      onSuccess: () => false,
    }),
)

it.prop('∀fields_JoinedAndPaddedIncludeTokens_=Accepted', [includeList], ([fields]) => {
  const joined = joinedTokens(fields)
  const padded = joined.map((token) => ` ${token} `)
  const expected: readonly HintId[] = Match.value(fields.length > 0).pipe(
    Match.when(true, (): readonly HintId[] => []),
    Match.when(false, (): readonly HintId[] => ['expansion']),
    Match.exhaustive,
  )
  const joinedIds = hintsOf(run({ include: joined })).map((hint) => hint.id)
  const paddedIds = hintsOf(run({ include: padded })).map((hint) => hint.id)
  return Result.isSuccess(offerRecoveryHints(run({ include: joined }))) &&
    Result.isSuccess(offerRecoveryHints(run({ include: padded }))) &&
    joinedIds.length === expected.length &&
    joinedIds.every((id, index) => id === expected[index]) &&
    paddedIds.length === expected.length &&
    paddedIds.every((id, index) => id === expected[index])
})
