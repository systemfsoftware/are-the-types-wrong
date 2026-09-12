import * as S from 'effect/Schema'

export class InvalidPackageSpec extends S.TaggedError<InvalidPackageSpec>()('InvalidPackageSpec', {
  message: S.String,
  recovery: S.String,
}) {}

export class ConfigInvalid extends S.TaggedError<ConfigInvalid>()('ConfigInvalid', {
  message: S.String,
  recovery: S.String,
}) {}

export class RegistryNotFound extends S.TaggedError<RegistryNotFound>()('RegistryNotFound', {
  message: S.String,
  recovery: S.String,
}) {}

export class RegistryUnreachable extends S.TaggedError<RegistryUnreachable>()('RegistryUnreachable', {
  message: S.String,
  recovery: S.String,
}) {}

export class RegistryBadResponse extends S.TaggedError<RegistryBadResponse>()('RegistryBadResponse', {
  message: S.String,
  recovery: S.String,
}) {}

export class PackFailed extends S.TaggedError<PackFailed>()('PackFailed', {
  message: S.String,
  recovery: S.String,
}) {}

export class TargetNotPackable extends S.TaggedError<TargetNotPackable>()('TargetNotPackable', {
  message: S.String,
  recovery: S.String,
}) {}

export class AnalysisFailed extends S.TaggedError<AnalysisFailed>()('AnalysisFailed', {
  message: S.String,
  recovery: S.String,
}) {}

export type AttwFailure =
  | InvalidPackageSpec
  | ConfigInvalid
  | RegistryNotFound
  | RegistryUnreachable
  | RegistryBadResponse
  | PackFailed
  | TargetNotPackable
  | AnalysisFailed

export const FailureKindSchema = S.Literals([
  'InvalidPackageSpec',
  'ConfigInvalid',
  'RegistryNotFound',
  'RegistryUnreachable',
  'RegistryBadResponse',
  'PackFailed',
  'TargetNotPackable',
  'AnalysisFailed',
])

export const FailureDocumentSchema = S.Struct({
  status: S.Literal('error'),
  kind: FailureKindSchema,
  message: S.String,
  recovery: S.String,
})

export type FailureDocument = S.Schema.Type<typeof FailureDocumentSchema>
