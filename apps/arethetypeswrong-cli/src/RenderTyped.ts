import type { Problem, ResolutionKind } from '@systemfsoftware/arethetypeswrong'
import type { AnsiAnnotation } from './RenderAnsi.js'
import { colorizeCell } from './RenderAnsi.js'
import { renderFlippedTable, renderTable } from './RenderTable.js'

export const resolutionKindOrder: readonly ResolutionKind[] = [
  'node10',
  'node16-cjs',
  'node16-esm',
  'bundler',
] as const

const emojiSymbols: Record<Problem['kind'], string> = {
  NoResolution: '✘',
  UntypedResolution: '◌',
  FalseESM: '✘',
  FalseCJS: '✘',
  CJSResolvesToESM: '✘',
  NamedExports: '✘',
  FallbackCondition: '⚠',
  FalseExportDefault: '✘',
  MissingExportEquals: '✘',
  UnexpectedModuleSyntax: '✘',
  InternalResolutionError: '✘',
  CJSOnlyExportsDefault: '✘',
}

const textSymbols: Record<Problem['kind'], string> = {
  NoResolution: 'X',
  UntypedResolution: '-',
  FalseESM: 'X',
  FalseCJS: 'X',
  CJSResolvesToESM: 'X',
  NamedExports: 'X',
  FallbackCondition: '!',
  FalseExportDefault: 'X',
  MissingExportEquals: 'X',
  UnexpectedModuleSyntax: 'X',
  InternalResolutionError: 'X',
  CJSOnlyExportsDefault: 'X',
}

export const symbolForProblem = (p: Problem, useEmoji: boolean): string => {
  if (useEmoji) return emojiSymbols[p.kind]
  return textSymbols[p.kind]
}

export type RenderOptions = {
  readonly flipped: boolean
  readonly useEmoji: boolean
  readonly color: boolean
}

const cellKey = (entrypoint: string, resolutionKind: ResolutionKind): string => `${entrypoint}\u0000${resolutionKind}`

const seedEntrypointCells = (cells: Map<string, Problem[]>, entrypoint: string): void => {
  for (const resolutionKind of resolutionKindOrder) {
    cells.set(cellKey(entrypoint, resolutionKind), [])
  }
}

const seedCells = (cells: Map<string, Problem[]>, entrypoints: readonly string[]): void => {
  for (const entrypoint of entrypoints) {
    seedEntrypointCells(cells, entrypoint)
  }
}

const problemEntrypoints = (problem: Problem, entrypoints: readonly string[]): readonly string[] => {
  if ('entrypoint' in problem) return [problem.entrypoint]
  return entrypoints
}

const problemResolutionKinds = (problem: Problem): readonly ResolutionKind[] => {
  if ('resolutionKind' in problem) return [problem.resolutionKind]
  return resolutionKindOrder
}

const pushProblemToCell = (
  cells: Map<string, Problem[]>,
  entrypoint: string,
  resolutionKind: ResolutionKind,
  problem: Problem,
): void => {
  cells.get(cellKey(entrypoint, resolutionKind))?.push(problem)
}

const pushProblemAlongKinds = (
  cells: Map<string, Problem[]>,
  entrypoint: string,
  resolutionKinds: readonly ResolutionKind[],
  problem: Problem,
): void => {
  for (const resolutionKind of resolutionKinds) {
    pushProblemToCell(cells, entrypoint, resolutionKind, problem)
  }
}

const pushProblem = (
  cells: Map<string, Problem[]>,
  entrypoints: readonly string[],
  resolutionKinds: readonly ResolutionKind[],
  problem: Problem,
): void => {
  for (const entrypoint of entrypoints) {
    pushProblemAlongKinds(cells, entrypoint, resolutionKinds, problem)
  }
}

/**
 * Bucket every problem into the (entrypoint x resolutionKind) cells it belongs to in one pass.
 * A problem carrying neither field is global and lands in every cell, which is why the walk is
 * over the problem's own axes rather than over the cells.
 */
export const partitionProblemsByCell = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
): ReadonlyMap<string, readonly Problem[]> => {
  const cells = new Map<string, Problem[]>()
  seedCells(cells, entrypoints)
  for (const problem of problems) {
    pushProblem(cells, problemEntrypoints(problem, entrypoints), problemResolutionKinds(problem), problem)
  }
  return cells
}

export const problemsForCell = (
  cells: ReadonlyMap<string, readonly Problem[]>,
  entrypoint: string,
  resolutionKind: ResolutionKind,
): readonly Problem[] => cells.get(cellKey(entrypoint, resolutionKind)) ?? []

const emptyCellMark = (useEmoji: boolean): string => {
  if (useEmoji) return '✔'
  return 'OK'
}

const cellMarkFor = (relevant: readonly Problem[], useEmoji: boolean): string => {
  if (relevant.length === 0) return emptyCellMark(useEmoji)
  return relevant.map((p) => symbolForProblem(p, useEmoji)).join('')
}

const typedRow = (
  entrypoint: string,
  cells: ReadonlyMap<string, readonly Problem[]>,
  opts: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): readonly string[] => {
  const row: string[] = [entrypoint]
  for (const resolutionKind of resolutionKindOrder) {
    row.push(cellMarkFor(problemsForCell(cells, entrypoint, resolutionKind), opts.useEmoji))
  }
  return row.map((c) => colorizeCell(c, opts.color, annotations))
}

const typedTable = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
  opts: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  const header: readonly string[] = ['Entrypoint', ...resolutionKindOrder]
  const cells = partitionProblemsByCell(entrypoints, problems)
  const rows = entrypoints.map((entrypoint) => typedRow(entrypoint, cells, opts, annotations))
  if (opts.flipped) return renderFlippedTable(header, rows)
  return renderTable(header, rows)
}

const typedAnalysisText = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
  opts: RenderOptions,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  if (entrypoints.length === 0) return 'No entrypoints found.'
  return typedTable(entrypoints, problems, opts, annotations)
}

export const renderTypedAnalysis = (
  entrypoints: readonly string[],
  problems: readonly Problem[],
  opts: RenderOptions,
  annotations: Record<string, AnsiAnnotation> = {},
): string => typedAnalysisText(entrypoints, problems, opts, annotations)
