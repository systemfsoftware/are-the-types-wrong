import { it } from '@effect/vitest'
import {
  type CheckResult,
  InternalResolutionErrorProblemSchema,
  type Problem,
  ProblemSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type MaskedProblem,
} from '../decode-envelope-document.workflow.js'
import { decideEnvelope } from '../envelope-document.js'
import { computeExitCode } from '../GetExitCode.js'
import { ComputeExitCodeCommand } from '../GetExitCode.schema.js'
import {
  decideMask,
  defaultEnvelopeMask,
  type EnvelopeMask,
  type EnvelopeMaskField,
  EnvelopeMaskFields,
} from '../Mask.js'
import { CliProblemFlags, CliResolutionKinds, problemFlagForKind } from '../ProblemUtils.js'

const defaultMaskContract: Readonly<Record<EnvelopeMaskField, boolean>> = {
  entrypoints: false,
  buildTools: false,
  programInfo: false,
  traces: false,
}

const tracedInternalResolutionError: fc.Arbitrary<Problem> = Schema
  .toArbitrary(InternalResolutionErrorProblemSchema)(fc)
  .map((problem) => ({ ...problem, trace: [...problem.trace, 'trace-entry'] }))

const problem: fc.Arbitrary<Problem> = fc.oneof(
  Schema.toArbitrary(ProblemSchema)(fc),
  tracedInternalResolutionError,
)

const countByKind = (problems: readonly Problem[]): Record<string, number> =>
  problems.reduce<Record<string, number>>((counts, one) => {
    counts[one.kind] = (counts[one.kind] ?? 0) + 1
    return counts
  }, {})

const typedEnvelopeSkeleton = (problems: readonly Problem[]): Readonly<Record<string, unknown>> => ({
  status: 'ok',
  packageName: 'demo',
  packageVersion: '1.0.0',
  types: { kind: 'included' },
  problems,
  problemCounts: countByKind(problems),
})

const untypedEnvelopeSkeleton = (): Readonly<Record<string, unknown>> => ({
  status: 'untyped',
  packageName: 'demo',
  packageVersion: '1.0.0',
  types: false,
})

const withoutKey = (
  document: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> => Object.fromEntries(Object.entries(document).filter(([each]) => each !== key))

const refusedDocuments = (generated: Problem): ReadonlyArray<unknown> => {
  const typed = typedEnvelopeSkeleton([generated])
  const untyped = untypedEnvelopeSkeleton()
  return [
    withoutKey(typed, 'problems'),
    withoutKey(typed, 'problemCounts'),
    withoutKey(typed, 'types'),
    withoutKey(typed, 'packageName'),
    withoutKey(typed, 'packageVersion'),
    withoutKey(typed, 'status'),
    { ...typed, status: 'partial' },
    { ...typed, types: false },
    { ...typed, undeclaredKey: 1 },
    { ...typed, problems: [{ ...generated, undeclaredKey: 1 }] },
    { ...untyped, problems: [generated] },
    { ...untyped, types: true },
    { ...untyped, undeclaredKey: 1 },
  ]
}

const decodeOf = (value: unknown) => decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value }))

const problemPayload: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(null, 0, '', {}, []),
  problem.map((one) => [one]),
)

const analysisOf = (problems: readonly Problem[]): CheckResult => ({
  packageName: 'demo',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems,
})

const untypedResult = (): CheckResult => ({ packageName: 'demo', packageVersion: '1.0.0', types: false })

const mask: fc.Arbitrary<EnvelopeMask> = fc.oneof(
  fc.constant(defaultEnvelopeMask),
  fc.record({
    entrypoints: fc.boolean(),
    buildTools: fc.boolean(),
    programInfo: fc.boolean(),
    traces: fc.boolean(),
  }),
)

const ignores: fc.Arbitrary<{ readonly rules: readonly string[]; readonly resolutions: readonly string[] }> = fc
  .record({
    rules: fc.array(fc.constantFrom(...CliProblemFlags), { maxLength: 3 }),
    resolutions: fc.array(fc.constantFrom(...CliResolutionKinds), { maxLength: 3 }),
  })

const authoredVisible = (
  one: Problem,
  ignored: { readonly rules: readonly string[]; readonly resolutions: readonly string[] },
): boolean =>
  !ignored.rules.includes(problemFlagForKind(one.kind)) &&
  !('resolutionKind' in one && ignored.resolutions.includes(one.resolutionKind))

const authoredMaskedProblems = (
  problems: readonly Problem[],
  ignored: { readonly rules: readonly string[]; readonly resolutions: readonly string[] },
  maskValue: EnvelopeMask,
): readonly MaskedProblem[] =>
  problems
    .filter((one) => authoredVisible(one, ignored))
    .map((one) => {
      if (maskValue.traces) return one
      if (one.kind === 'InternalResolutionError') {
        const { trace: _trace, ...rest } = one
        return rest
      }
      return one
    })

const sameKindSequence = (left: readonly MaskedProblem[], right: readonly MaskedProblem[]): boolean =>
  left.length === right.length && left.every((one, index) => one.kind === right[index]?.kind)

const carriesTrace = (one: MaskedProblem): boolean => 'trace' in one

const defaultMaskHolds = EnvelopeMaskFields.every((field) => defaultEnvelopeMask[field] === defaultMaskContract[field])

it.prop(
  '∀problem_TypedEnvelopeSkeleton_=OkEnvelopeAccepted',
  [problem],
  ([generated]) =>
    Result.match(decodeOf(typedEnvelopeSkeleton([generated])), {
      onSuccess: (decision) =>
        decision._tag === 'OkEnvelopeAccepted' &&
        decision.document.packageName === 'demo' &&
        decision.document.packageVersion === '1.0.0' &&
        decision.document.status === 'ok' &&
        decision.document.problems.length === 1 &&
        decision.document.problems[0]?.kind === generated.kind,
      onFailure: () => false,
    }),
)

it.prop(
  '∀payload_UntypedEnvelope_∌problems',
  [problemPayload],
  ([payload]) =>
    Result.match(decodeOf(untypedEnvelopeSkeleton()), {
      onSuccess: (decision) => decision._tag === 'UntypedEnvelopeAccepted' && decision.document.status === 'untyped',
      onFailure: () => false,
    }) &&
    Result.isFailure(decodeOf({ ...untypedEnvelopeSkeleton(), problems: payload })),
)

it.prop(
  '∀problem_MutatedEnvelope_⊥Decode',
  [problem],
  ([generated]) => refusedDocuments(generated).every((value) => Result.isFailure(decodeOf(value))),
)

it.prop(
  '∀problem,mask,ignores,typed_EnvelopeContract_=authoredModel',
  [problem, mask, ignores, fc.boolean()],
  ([generated, maskValue, ignored, typed]) => {
    const result = typed ? analysisOf([generated]) : untypedResult()
    const decision = decideEnvelope({
      result,
      ignoreRules: [...ignored.rules],
      ignoreResolutions: [...ignored.resolutions],
      mask: maskValue,
    })
    const document = decision.document
    if (!typed) {
      return defaultMaskHolds &&
        document.status === 'untyped' &&
        !('problems' in document) &&
        decision.exitCode === 0
    }
    const expectedProblems = authoredMaskedProblems([generated], ignored, maskValue)
    const expectedExitCode = computeExitCode(
      new ComputeExitCodeCommand({
        result,
        ignoreRules: [...ignored.rules],
        ignoreResolutions: [...ignored.resolutions],
      }),
    ).exitCode
    if (document.status !== 'ok') return false
    return defaultMaskHolds &&
      decision.exitCode === expectedExitCode &&
      Array.isArray(document.problems) &&
      ('entrypoints' in document) === maskValue.entrypoints &&
      ('buildTools' in document) === maskValue.buildTools &&
      ('programInfo' in document) === maskValue.programInfo &&
      sameKindSequence(document.problems, expectedProblems) &&
      document.problems.every((one) =>
        one.kind !== 'InternalResolutionError' || carriesTrace(one) === maskValue.traces
      ) &&
      Object.values(document.problemCounts).reduce((sum, count) => sum + count, 0) ===
        document.problems.length &&
      Object.entries(document.problemCounts).every(([kind, count]) =>
        count === document.problems.filter((one) => one.kind === kind).length
      )
  },
)

const includeList: fc.Arbitrary<readonly EnvelopeMaskField[]> = fc.uniqueArray(
  fc.constantFrom(...EnvelopeMaskFields),
  { maxLength: 4 },
)

const unknownMaskField: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[^a-zA-Z]{1,8}$/),
  fc
    .tuple(fc.constantFrom(...EnvelopeMaskFields), fc.constantFrom(' ', '-', 's', '!'))
    .map(([field, suffix]) => `${field}${suffix}`),
)

it.prop('∀include_MaskDecision_=authoredMapping', [includeList], ([include]) => {
  const authoredMapping: Readonly<Record<EnvelopeMaskField, boolean>> = {
    entrypoints: include.includes('entrypoints'),
    buildTools: include.includes('buildTools'),
    programInfo: include.includes('programInfo'),
    traces: include.includes('traces'),
  }
  return Result.match(decideMask(include), {
    onSuccess: (maskValue) => EnvelopeMaskFields.every((field) => maskValue[field] === authoredMapping[field]),
    onFailure: () => false,
  })
})

it.prop('∀field_MaskDecisionRefusal_=field', [unknownMaskField], ([field]) => {
  const decided = decideMask([field])
  return Result.isFailure(decided) && decided.failure.field === field
})
