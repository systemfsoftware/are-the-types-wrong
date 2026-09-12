import { Result } from 'effect'

export const EnvelopeMaskFields = ['entrypoints', 'buildTools', 'programInfo', 'traces'] as const

export type EnvelopeMaskField = typeof EnvelopeMaskFields[number]

export interface EnvelopeMask {
  readonly entrypoints: boolean
  readonly buildTools: boolean
  readonly programInfo: boolean
  readonly traces: boolean
}

export interface UnknownMaskField {
  readonly field: string
}

export const defaultEnvelopeMask: EnvelopeMask = {
  entrypoints: false,
  buildTools: false,
  programInfo: false,
  traces: false,
}

const everyMaskField: readonly string[] = EnvelopeMaskFields

const isMaskField = (field: string): field is EnvelopeMaskField => everyMaskField.includes(field)

const maskFrom = (include: readonly string[]): EnvelopeMask => ({
  entrypoints: include.includes('entrypoints'),
  buildTools: include.includes('buildTools'),
  programInfo: include.includes('programInfo'),
  traces: include.includes('traces'),
})

export const decideMask = (include: readonly string[]): Result.Result<EnvelopeMask, UnknownMaskField> => {
  const unknown = include.find((field) => !isMaskField(field))
  if (unknown !== undefined) return Result.fail({ field: unknown })
  return Result.succeed(maskFrom(include))
}
