import { it } from '@effect/vitest'
import {
  type CheckResult,
  InternalResolutionErrorProblemSchema,
  type Problem,
  ProblemSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Match, Predicate, Result, Schema } from 'effect'
import * as fc from 'effect/testing/FastCheck'

import {
  decodeEnvelopeDocument,
  EnvelopeDocumentCommand,
  type OkEnvelope,
  OkEnvelopeSchema,
} from '../decode-envelope-document.workflow.js'
import { decideEnvelope } from '../envelope-document.js'
import { computeExitCode } from '../GetExitCode.js'
import { ComputeExitCodeCommand } from '../GetExitCode.schema.js'
import { decideMask, defaultEnvelopeMask, type EnvelopeMaskField, EnvelopeMaskFields } from '../Mask.js'
import { CliProblemFlags, CliResolutionKinds, problemFlagForKind } from '../ProblemUtils.js'

const tracedInternalResolutionError: fc.Arbitrary<Problem> = Schema
  .toArbitrary(InternalResolutionErrorProblemSchema)(fc)
  .map((problem) => ({ ...problem, trace: [...problem.trace, 'trace-entry'] }))

const problem: fc.Arbitrary<Problem> = fc.oneof(
  Schema.toArbitrary(ProblemSchema)(fc),
  tracedInternalResolutionError,
)

const ignores: fc.Arbitrary<{ readonly rules: readonly string[]; readonly resolutions: readonly string[] }> = fc
  .record({
    rules: fc.array(fc.constantFrom(...CliProblemFlags), { maxLength: 3 }),
    resolutions: fc.array(fc.constantFrom(...CliResolutionKinds), { maxLength: 3 }),
  })

const analysisOf = (problems: readonly Problem[]): CheckResult => ({
  packageName: 'pkg',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems,
})

const envelopeFor = (
  result: CheckResult,
  ignored: { readonly rules: readonly string[]; readonly resolutions: readonly string[] },
  traces: boolean,
) =>
  decideEnvelope({
    result,
    ignoreRules: ignored.rules,
    ignoreResolutions: ignored.resolutions,
    mask: { ...defaultEnvelopeMask, traces },
  })

const maskField: fc.Arbitrary<EnvelopeMaskField> = fc.constantFrom(...EnvelopeMaskFields)

const unknownMaskField: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[^a-zA-Z]{1,8}$/),
  fc.tuple(maskField, fc.constantFrom(' ', '-', 's', '!')).map(([field, suffix]) => `${field}${suffix}`),
)

const problemsValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant([]),
  fc.constant(null),
  fc.constant({}),
  fc.constant([{ kind: 'NoResolution' }]),
  fc.string(),
  fc.integer(),
)

const okEnvelope: fc.Arbitrary<OkEnvelope> = Schema.toArbitrary(OkEnvelopeSchema)(fc)

it.prop('∀ignores_UntypedEnvelope_=exit0∧∌problems', [ignores], ([ignored]) => {
  const untyped: CheckResult = { packageName: 'pkg', packageVersion: '1.0.0', types: false }
  const decision = envelopeFor(untyped, ignored, false)
  return decision.exitCode === 0 && decision.document.status === 'untyped' &&
    !('problems' in decision.document)
})

it.prop('∀problem,ignores_TypedEnvelopeExit_=f(visibleProblem)', [problem, ignores], ([problem, ignored]) => {
  const result = analysisOf([problem])
  const decision = envelopeFor(result, ignored, false)
  const exitDecision = computeExitCode(
    new ComputeExitCodeCommand({
      result,
      ignoreRules: [...ignored.rules],
      ignoreResolutions: [...ignored.resolutions],
    }),
  )
  const visible = !ignored.rules.includes(problemFlagForKind(problem.kind)) &&
    !('resolutionKind' in problem && ignored.resolutions.includes(problem.resolutionKind))
  return decision.document.status === 'ok' &&
    decision.exitCode === exitDecision.exitCode &&
    (decision.document.problems.length > 0) === visible &&
    (decision.exitCode === 0) === (decision.document.problems.length === 0)
})

it.prop('∀problem_DefaultMask_=tight∧problemCounts=problem', [problem], ([problem]) => {
  const document = envelopeFor(analysisOf([problem]), { rules: [], resolutions: [] }, false).document
  if (document.status !== 'ok') return false
  let expected: unknown = problem
  if (problem.kind === 'InternalResolutionError') {
    const { trace: _trace, ...rest } = problem
    expected = rest
  }
  const countSum = Object.values(document.problemCounts).reduce((sum, count) => sum + count, 0)
  return document.entrypoints === undefined &&
    document.buildTools === undefined &&
    document.programInfo === undefined &&
    JSON.stringify(document.problems) === JSON.stringify([expected]) &&
    JSON.stringify(document.problemCounts) === JSON.stringify({ [problem.kind]: 1 }) &&
    countSum === document.problems.length &&
    document.problems.every((masked) => !('trace' in masked))
})

it.prop('∀problem_TracesIncluded_=problem', [problem], ([problem]) => {
  const decision = envelopeFor(analysisOf([problem]), { rules: [], resolutions: [] }, true)
  return decision.document.status === 'ok' &&
    JSON.stringify(decision.document.problems) === JSON.stringify([problem])
})

it.prop('∀value_DecodeUntypedEnvelope_=refused', [problemsValue], ([value]) => {
  const untyped = { status: 'untyped', packageName: 'pkg', packageVersion: '1.0.0', types: false } as const
  return Result.match(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value: untyped })), {
    onSuccess: (decision) => Predicate.isTagged(decision, 'UntypedEnvelopeAccepted'),
    onFailure: () => false,
  }) &&
    Result.isFailure(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value: { ...untyped, problems: value } })))
})

it.prop(
  '∀document_OkEnvelope_=OkEnvelopeAccepted',
  [okEnvelope],
  ([document]) =>
    Result.match(decodeEnvelopeDocument(new EnvelopeDocumentCommand({ value: document })), {
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('OkEnvelopeAccepted', ({ document: accepted }) =>
            accepted.packageName === document.packageName &&
            accepted.packageVersion === document.packageVersion &&
            JSON.stringify(accepted.types) === JSON.stringify(document.types) &&
            JSON.stringify(accepted.problemCounts) === JSON.stringify(document.problemCounts) &&
            accepted.problems.length === document.problems.length),
          Match.tag('UntypedEnvelopeAccepted', () => false),
          Match.exhaustive,
        ),
      onFailure: () => false,
    }),
)

it.prop('∀include_MaskDecide_=defaultMask∪include', [fc.array(maskField, { maxLength: 4 })], ([include]) => {
  const decided = decideMask(include)
  const expected = {
    entrypoints: include.includes('entrypoints'),
    buildTools: include.includes('buildTools'),
    programInfo: include.includes('programInfo'),
    traces: include.includes('traces'),
  }
  return Result.isSuccess(decided) && JSON.stringify(decided.success) === JSON.stringify(expected)
})

it.prop('∀field_MaskDecideRefusal_=field', [unknownMaskField], ([field]) => {
  const decided = decideMask([field])
  return Result.isFailure(decided) && decided.failure.field === field
})
