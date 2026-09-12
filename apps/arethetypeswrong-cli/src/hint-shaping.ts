export const HintIds = ['expansion', 'directoryWithoutPack', 'untyped'] as const

export type HintId = typeof HintIds[number]

export interface Hint {
  readonly id: HintId
  readonly text: string
}

export const renderHints = (hints: readonly Hint[]): string => hints.map((hint) => `${hint.text}\n`).join('')
