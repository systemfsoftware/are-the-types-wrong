import { it } from '@effect/vitest'
import { Match, Predicate, Result } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import { CliInputSchema } from '../CliInput.schema.js'
import type { MachineEnvelope } from '../decode-envelope-document.workflow.js'
import { type HintId, HintIds, renderHints } from '../hint-shaping.js'
import { decodeIncludeMask, type EnvelopeMask, type EnvelopeMaskField, EnvelopeMaskFields } from '../Mask.js'
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
      document: overrides.document ?? okDocument('pkg'),
      mode: overrides.mode ?? 'envelope',
      isTty: overrides.isTty ?? false,
      include: overrides.include ?? [],
      mask: overrides.mask ?? noFields,
    }),
  })

const packlessDirectory = new DecideHintsCommand({ request: new PacklessDirectoryHintsRequest({}) })

const decisions = (command: DecideHintsCommand) => Result.getOrThrow(offerRecoveryHints(command))

const hintList = (command: DecideHintsCommand) =>
  Match.value(decisions(command)).pipe(
    Match.tag('HintsOffered', ({ hints }) => hints),
    Match.tag('NoHintsApplicable', () => []),
    Match.exhaustive,
  )

const hintIds = (command: DecideHintsCommand): readonly HintId[] =>
  Match.value(decisions(command)).pipe(
    Match.tag('HintsOffered', ({ hints }) => hints.map((hint) => hint.id)),
    Match.tag('NoHintsApplicable', () => []),
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

const situationSpecs: Readonly<Record<Situation, SituationSpec>> = {
  tty: { state: run({ isTty: true }), hints: [] },
  quiet: { state: run({ mode: 'quiet' }), hints: [] },
  explicitTable: { state: run({ mode: 'table' }), hints: [] },
  untyped: { state: run({ document: untypedDocument('pkg') }), hints: ['untyped'] },
  untypedWithInclude: {
    state: run({ document: untypedDocument('pkg'), include: ['entrypoints'] }),
    hints: ['untyped'],
  },
  expansion: { state: run({}), hints: ['expansion'] },
  partialMask: { state: run({ mask: oneField }), hints: ['expansion'] },
  includeGiven: { state: run({ include: ['entrypoints'] }), hints: [] },
  redundantInclude: { state: run({ include: [...EnvelopeMaskFields], mask: allFields }), hints: [] },
  nothingOmitted: { state: run({ mask: allFields }), hints: [] },
  directoryWithoutPack: { state: packlessDirectory, hints: ['directoryWithoutPack'] },
}

const renderModes = ['envelope', 'table', 'table-flipped', 'ascii', 'quiet'] as const satisfies readonly RenderMode[]

const maskValue: fc.Arbitrary<EnvelopeMask> = fc.record({
  entrypoints: fc.boolean(),
  buildTools: fc.boolean(),
  programInfo: fc.boolean(),
  traces: fc.boolean(),
})

const includedFields: fc.Arbitrary<EnvelopeMaskField[]> = fc.uniqueArray(
  fc.constantFrom(...EnvelopeMaskFields),
  { maxLength: 4 },
)

const enumeratedInclude: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(...EnvelopeMaskFields),
  { maxLength: 4 },
)

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
  include: enumeratedInclude,
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

const includeArg = (fields: readonly string[]): readonly string[] =>
  Match.value(fields).pipe(
    Match.when((value) => value.length === 0, () => []),
    Match.orElse((value) => [value.join(', ')]),
  )

const nonFieldToken: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom(...EnvelopeMaskFields),
      fc.stringMatching(/^[A-Za-z0-9.-]{1,4}$/),
    )
    .map(([field, suffix]) => `${field}${suffix}`),
  fc.constantFrom('table', 'json', 'ascii', '-f', ''),
)

it.prop('∀situation_Hints_=table', [fc.constantFrom(...situationNames)], ([situation]) => {
  const spec = situationSpecs[situation]
  return JSON.stringify(hintIds(spec.state)) === JSON.stringify(spec.hints)
})

it.prop('∀hostilePackageName_Hints_=nameIndependent∧∌ESC', [hostileRunInputs], ([inputs]) => {
  const hostile = hintList(runNamed(inputs, inputs.packageName))
  const text = renderHints(hostile)
  return JSON.stringify(hintIds(runNamed(inputs, inputs.packageName))) ===
      JSON.stringify(hintIds(runNamed(inputs, 'benign-package'))) &&
    hostile.every((hint) => !hint.text.includes(inputs.packageName)) &&
    !text.includes(inputs.packageName) &&
    !text.includes(escape)
})

it.prop('∀hintId_HintFlags_∈CliInputSchema', [fc.constantFrom(...HintIds)], ([id]) => {
  const texts = situationNames
    .flatMap((situation) => hintList(situationSpecs[situation].state))
    .filter((hint) => hint.id === id)
    .map((hint) => hint.text)
  return texts.length > 0 &&
    texts.every((text) => flagTokensIn(text).every((flag) => flag in CliInputSchema.fields))
})

it.prop(
  '∀token_HintsIncludeRefusal_⊥Hints',
  [nonFieldToken],
  ([token]) =>
    Result.match(offerRecoveryHints(run({ include: [token] })), {
      onFailure: (refusal) =>
        Predicate.isTagged(refusal, 'InvalidPackageSpec') &&
        EnvelopeMaskFields.every((field) => refusal.recovery.includes(field)),
      onSuccess: () => false,
    }),
)

it.prop('∀fields_DecodeIncludeMask_=include', [includedFields], ([fields]) => {
  const decided = decodeIncludeMask(includeArg(fields))
  return Result.isSuccess(decided) &&
    EnvelopeMaskFields.every((field) => decided.success[field] === fields.includes(field))
})

it.prop('∀fields_RepeatedInclude_=union', [includedFields, includedFields], ([first, second]) => {
  const decided = decodeIncludeMask([...includeArg(first), ...includeArg(second)])
  const requested = [...first, ...second]
  return Result.isSuccess(decided) &&
    EnvelopeMaskFields.every((field) => decided.success[field] === requested.includes(field))
})

it.prop('∀token_DecodeIncludeMaskRefusal_⊥', [nonFieldToken], ([token]) => {
  const decided = decodeIncludeMask([token])
  return Result.isFailure(decided) &&
    EnvelopeMaskFields.every((field) => decided.failure.recovery.includes(field))
})
