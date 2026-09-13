import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

import { MachineEnvelopeSchema } from './decode-envelope-document.workflow.js'
import { type Hint, HintIds } from './hint-shaping.js'
import { RenderModeSchema } from './select-render-mode.workflow.js'

const EnvelopeMaskSchema = S.Struct({
  entrypoints: S.Boolean,
  buildTools: S.Boolean,
  programInfo: S.Boolean,
  traces: S.Boolean,
})

const HintSchema = S.Struct({ id: S.Literals(HintIds), text: S.String })

const maskFields = ['entrypoints', 'buildTools', 'programInfo', 'traces'] as const

const everyMaskField: readonly string[] = maskFields

const expansionHint: Hint = {
  id: 'expansion',
  text: `The envelope omits fields. Rerun with --include ${maskFields.join(', ')} to include any of them.`,
}

const untypedHint: Hint = {
  id: 'untyped',
  text:
    'This package ships no types, so the envelope status is "untyped" and carries no problems. Read the status discriminator, not the exit code, to tell typed from untyped.',
}

const directoryWithoutPackHint: Hint = {
  id: 'directoryWithoutPack',
  text:
    'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.',
}

export class RunHintsRequest extends S.TaggedClass<RunHintsRequest>()('RunHintsRequest', {
  document: MachineEnvelopeSchema,
  mode: RenderModeSchema,
  isTty: S.Boolean,
  include: S.Array(S.String),
  mask: EnvelopeMaskSchema,
}) {}

export class PacklessDirectoryHintsRequest extends S.TaggedClass<PacklessDirectoryHintsRequest>()(
  'PacklessDirectoryHintsRequest',
  {},
) {}

export class DecideHintsCommand extends S.TaggedClass<DecideHintsCommand>()('DecideHintsCommand', {
  request: S.Union([RunHintsRequest, PacklessDirectoryHintsRequest]),
}) {}

const HintsDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/arethetypeswrong-cli/HintsDecision')
type HintsDecisionTypeId = typeof HintsDecisionTypeId

export class HintsOffered extends S.TaggedClass<HintsOffered>()('HintsOffered', {
  hints: S.NonEmptyArray(HintSchema),
}) {
  readonly [HintsDecisionTypeId] = HintsDecisionTypeId
}

export class NoHintsApplicable extends S.TaggedClass<NoHintsApplicable>()('NoHintsApplicable', {}) {
  readonly [HintsDecisionTypeId] = HintsDecisionTypeId
}

class IncludeTokensRefused extends S.TaggedError<IncludeTokensRefused>()('InvalidPackageSpec', {
  message: S.String,
  recovery: S.String,
}) {
  readonly [HintsDecisionTypeId] = HintsDecisionTypeId
}

export type HintsDecision = HintsOffered | NoHintsApplicable

const includeTokenClassSchema = S.Literals(['accepted', 'refused'])

type IncludeTokenClass = S.Schema.Type<typeof includeTokenClassSchema>

const includeTokenClass = (tokens: readonly string[]): IncludeTokenClass =>
  Match.value(tokens.every((token) => everyMaskField.includes(token))).pipe(
    Match.when(true, (): IncludeTokenClass => 'accepted'),
    Match.when(false, (): IncludeTokenClass => 'refused'),
    Match.exhaustive,
  )

const includeTokensRefused = (): IncludeTokensRefused =>
  new IncludeTokensRefused({
    message: 'The --include flag names a field this tool does not accept.',
    recovery: `Pass --include with a comma-separated list of ${maskFields.join(', ')}.`,
  })

const parseIncludeTokens = (raw: readonly string[]): readonly string[] =>
  raw.flatMap((value) => value.split(',').map((token) => token.trim()))

const hintSituationSchema = S.Literals([
  'tty',
  'notEnvelope',
  'untyped',
  'includeGiven',
  'nothingOmitted',
  'expansion',
])

type HintSituation = S.Schema.Type<typeof hintSituationSchema>

const hintSituation = (request: RunHintsRequest): HintSituation =>
  Match.value(request.isTty).pipe(
    Match.when(true, (): HintSituation => 'tty'),
    Match.when(false, (): HintSituation =>
      Match.value(request.mode !== 'envelope').pipe(
        Match.when(true, (): HintSituation => 'notEnvelope'),
        Match.when(false, (): HintSituation =>
          Match.value(request.document.status === 'untyped').pipe(
            Match.when(true, (): HintSituation => 'untyped'),
            Match.when(false, (): HintSituation =>
              Match.value(request.include.length > 0).pipe(
                Match.when(true, (): HintSituation => 'includeGiven'),
                Match.when(false, (): HintSituation =>
                  Match.value(maskFields.every((field) => request.mask[field])).pipe(
                    Match.when(true, (): HintSituation => 'nothingOmitted'),
                    Match.when(false, (): HintSituation => 'expansion'),
                    Match.exhaustive,
                  )),
                Match.exhaustive,
              )),
            Match.exhaustive,
          )),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const hintsForSituation = (situation: HintSituation): HintsDecision =>
  Match.value(situation).pipe(
    Match.when('tty', () => new NoHintsApplicable()),
    Match.when('notEnvelope', () => new NoHintsApplicable()),
    Match.when('untyped', () => new HintsOffered({ hints: [untypedHint] })),
    Match.when('includeGiven', () => new NoHintsApplicable()),
    Match.when('nothingOmitted', () => new NoHintsApplicable()),
    Match.when('expansion', () => new HintsOffered({ hints: [expansionHint] })),
    Match.exhaustive,
  )

export const offerRecoveryHints = Workflow.make(
  DecideHintsCommand,
  (command): Result.Result<HintsDecision, IncludeTokensRefused> =>
    Match.value(command.request).pipe(
      Match.tag('PacklessDirectoryHintsRequest', () =>
        Result.succeed(new HintsOffered({ hints: [directoryWithoutPackHint] }))),
      Match.tag('RunHintsRequest', (request) =>
        Match.value(includeTokenClass(parseIncludeTokens(request.include))).pipe(
          Match.when('refused', () =>
            Result.fail(includeTokensRefused())),
          Match.when('accepted', () => Result.succeed(hintsForSituation(hintSituation(request)))),
          Match.exhaustive,
        )),
      Match.exhaustive,
    ),
)
