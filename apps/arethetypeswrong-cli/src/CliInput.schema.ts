import * as S from 'effect/Schema'

import { CliFormat, CliProfile } from './ProblemUtils.js'

export const CliInputSchema = S.Struct({
  'pack': S.Boolean,
  'from-npm': S.Boolean,
  'definitely-typed': S.optionalKey(S.String),
  'format': S.Literals(CliFormat),
  'quiet': S.Boolean,
  'entrypoints': S.optionalKey(S.Array(S.String)),
  'include-entrypoints': S.optionalKey(S.Array(S.String)),
  'exclude-entrypoints': S.optionalKey(S.Array(S.String)),
  'include': S.optionalKey(S.Array(S.Literals(['entrypoints', 'buildTools', 'programInfo', 'traces']))),
  'entrypoints-legacy': S.Boolean,
  'ignore-rules': S.optionalKey(S.Array(S.String)),
  'profile': S.Literals(CliProfile),
  'summary': S.Boolean,
  'emoji': S.Boolean,
  'color': S.Boolean,
  'registry': S.String,
})
