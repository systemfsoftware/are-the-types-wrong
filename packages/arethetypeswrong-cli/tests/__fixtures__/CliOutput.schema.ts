import { Schema } from 'effect'

export const analysisOutput = Schema.fromJsonString(
  Schema.Struct({
    analysis: Schema.Struct({ packageName: Schema.optional(Schema.String) }),
    problems: Schema.optional(Schema.Unknown),
  }),
)

export const packageNameOutput = Schema.fromJsonString(
  Schema.Struct({ analysis: Schema.Struct({ packageName: Schema.String }) }),
)

export const entrypointsOutput = Schema.fromJsonString(
  Schema.Struct({
    analysis: Schema.Struct({ entrypoints: Schema.Record(Schema.String, Schema.Unknown) }),
  }),
)
