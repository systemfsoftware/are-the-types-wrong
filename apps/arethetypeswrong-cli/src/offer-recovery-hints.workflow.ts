import { Array, Match, Option } from 'effect'

import type { MachineEnvelope } from './Envelope.schema.js'
import { type EnvelopeMask, EnvelopeMaskFields } from './Mask.js'
import type { RenderMode } from './RenderMode.schema.js'

export const HintIds = ['expansion', 'directoryWithoutPack', 'untyped'] as const

export type HintId = typeof HintIds[number]

export interface Hint {
  readonly id: HintId
  readonly text: string
}

const expansionHint: Hint = {
  id: 'expansion',
  text: `The envelope omits fields. Rerun with --include ${EnvelopeMaskFields.join(', ')} to include any of them.`,
}

const untypedHint: Hint = {
  id: 'untyped',
  text:
    'This package ships no types, so the envelope status is "untyped" and carries no problems. Read the status discriminator, not the exit code, to tell typed from untyped.',
}

export const directoryWithoutPackHint: Hint = {
  id: 'directoryWithoutPack',
  text:
    'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.',
}

export interface RunHintState {
  readonly kind: 'run'
  readonly document: MachineEnvelope
  readonly mode: RenderMode
  readonly isTty: boolean
  readonly include: readonly string[]
  readonly mask: EnvelopeMask
}

export interface DirectoryWithoutPackHintState {
  readonly kind: 'directoryWithoutPack'
}

export type HintState = RunHintState | DirectoryWithoutPackHintState

interface HintRule {
  readonly test: (state: RunHintState) => boolean
  readonly hints: readonly Hint[]
}

const omitsNothing = (mask: EnvelopeMask): boolean => EnvelopeMaskFields.every((field) => mask[field])

const runHintRules: readonly HintRule[] = [
  { test: (state) => state.isTty, hints: [] },
  { test: (state) => state.mode !== 'envelope', hints: [] },
  { test: (state) => state.document.status === 'untyped', hints: [untypedHint] },
  { test: (state) => state.include.length > 0, hints: [] },
  { test: (state) => omitsNothing(state.mask), hints: [] },
  { test: () => true, hints: [expansionHint] },
]

const runHints = (state: RunHintState): readonly Hint[] =>
  Option.match(
    Array.findFirst(runHintRules, (rule) => rule.test(state)),
    { onNone: () => [], onSome: (rule) => rule.hints },
  )

export const hintsFor = (state: HintState): readonly Hint[] =>
  Match.value(state).pipe(
    Match.when({ kind: 'directoryWithoutPack' }, () => [directoryWithoutPackHint]),
    Match.when({ kind: 'run' }, runHints),
    Match.exhaustive,
  )

export const renderHints = (hints: readonly Hint[]): string => hints.map((hint) => `${hint.text}\n`).join('')
