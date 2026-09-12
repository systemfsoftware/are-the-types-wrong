import type { AttwFailure, FailureDocument } from './Failure.schema.js'
import { RegistryBadResponse, RegistryNotFound, RegistryUnreachable } from './Failure.schema.js'

export type RegistryObservation =
  | { readonly kind: 'http-status'; readonly status: number }
  | { readonly kind: 'no-response' }
  | { readonly kind: 'unexpected-shape' }

const retryRegistry = 'Check network access and the --registry URL, then rerun the same command.'

const httpStatusFailure = (status: number): AttwFailure => {
  if (status === 404) {
    return new RegistryNotFound({
      message: 'The registry has no package or version matching that target.',
      recovery: 'Check the package name and version, then rerun the same command.',
    })
  }
  return new RegistryBadResponse({
    message: `The registry answered with HTTP ${status}.`,
    recovery: retryRegistry,
  })
}

export const classifyRegistryFailure = (observation: RegistryObservation): AttwFailure => {
  if (observation.kind === 'http-status') return httpStatusFailure(observation.status)
  if (observation.kind === 'no-response') {
    return new RegistryUnreachable({
      message: 'The registry did not answer.',
      recovery: retryRegistry,
    })
  }
  return new RegistryBadResponse({
    message: 'The registry answered with a document this tool cannot read.',
    recovery: retryRegistry,
  })
}

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
