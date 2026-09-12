import * as S from 'effect/Schema'

export const ConditionalExportsEvent = S.Literals(['Entered', 'Exited', 'Failed', 'Resolved'])
export type ConditionalExportsEvent = S.Schema.Type<typeof ConditionalExportsEvent>

export const ConditionalExportsScript = S.NullOr(S.Array(ConditionalExportsEvent))
export type ConditionalExportsScript = S.Schema.Type<typeof ConditionalExportsScript>
