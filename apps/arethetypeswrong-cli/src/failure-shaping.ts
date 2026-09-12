import type { AttwFailure, FailureDocument } from './Failure.schema.js'

export interface FailureOutcome {
  readonly document: string
  readonly exitCode: number
}

const failureDocument = (failure: AttwFailure): FailureDocument => ({
  status: 'error',
  kind: failure._tag,
  message: failure.message,
  recovery: failure.recovery,
})

const proseLine = (failure: AttwFailure): string => `${failure.message} ${failure.recovery}\n`

export const failureOutcome = (failure: AttwFailure, options: { readonly isTty: boolean }): FailureOutcome => {
  if (options.isTty) return { document: proseLine(failure), exitCode: 1 }
  return { document: `${JSON.stringify(failureDocument(failure))}\n`, exitCode: 1 }
}
