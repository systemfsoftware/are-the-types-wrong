import type { Problem } from '@systemfsoftware/arethetypeswrong'
import { renderTable } from './RenderTable.js'
import { partitionProblemsByCell, problemsForCell, resolutionKindOrder, symbolForProblem } from './RenderTyped.js'

const asciiMarkFor = (relevant: readonly Problem[], useEmoji: boolean): string => {
  if (relevant.length === 0) return 'OK'
  return relevant.map((p) => symbolForProblem(p, useEmoji)).join('')
}

const asciiRow = (
  entrypoint: string,
  cells: ReadonlyMap<string, readonly Problem[]>,
  useEmoji: boolean,
): readonly string[] => {
  const row: string[] = [entrypoint]
  for (const resolutionKind of resolutionKindOrder) {
    row.push(asciiMarkFor(problemsForCell(cells, entrypoint, resolutionKind), useEmoji))
  }
  return row
}

const asciiTable = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
  useEmoji: boolean,
): string => {
  const header: readonly string[] = ['Entrypoint', ...resolutionKindOrder]
  const cells = partitionProblemsByCell(entrypoints, problems)
  const rows = entrypoints.map((entrypoint) => asciiRow(entrypoint, cells, useEmoji))
  return renderTable(header, rows)
}

export const renderAsciiAnalysis = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
  opts: { readonly useEmoji: boolean },
): string => {
  if (entrypoints.length === 0) return 'No entrypoints found.'
  return asciiTable(entrypoints, problems, opts.useEmoji)
}
