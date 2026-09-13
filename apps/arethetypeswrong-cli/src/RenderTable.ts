export type Cell = string

export const cellWidth = (cell: Cell): number => visibleWidth(cell)

const ESCAPE = '\u001b'

const visibleCharWidth = (ch: string): number => {
  if (ch === ESCAPE) return 0
  return 1
}

const visibleWidth = (s: string): number => {
  let w = 0
  for (const ch of s) {
    w += visibleCharWidth(ch)
  }
  return w
}

const widthAt = (widths: ReadonlyArray<number>, i: number): number => widths[i] ?? 0

const cellAt = (cells: ReadonlyArray<Cell>, i: number): Cell => cells[i] ?? ''

const widenColumn = (widths: Array<number>, i: number, width: number): void => {
  if (width > widthAt(widths, i)) {
    widths[i] = width
  }
}

const widenColumns = (widths: Array<number>, row: ReadonlyArray<Cell>): void => {
  for (let i = 0; i < row.length; i++) {
    widenColumn(widths, i, cellWidth(cellAt(row, i)))
  }
}

export const computeColumnWidths = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
): ReadonlyArray<number> => {
  const widths: Array<number> = header.map(cellWidth)
  for (const row of rows) {
    widenColumns(widths, row)
  }
  return widths
}

const renderCell = (cell: Cell, width: number): string => cell.padEnd(width)

const renderRow = (
  cells: ReadonlyArray<Cell>,
  widths: ReadonlyArray<number>,
  gapText: string,
): string => cells.map((cell, i) => renderCell(cell, widthAt(widths, i))).join(gapText)

const renderTableText = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number,
): string => {
  if (header.length === 0) return ''
  const widths = computeColumnWidths(header, rows)
  const gapText = ' '.repeat(gap)
  const headerRow = renderRow(header, widths, gapText)
  const dataRows = rows.map((row) => renderRow(row, widths, gapText))
  return [headerRow, ...dataRows].join('\n')
}

export const renderTable = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number = 2,
): string => renderTableText(header, rows, gap)

const rowAt = (rows: ReadonlyArray<ReadonlyArray<Cell>>, i: number): ReadonlyArray<Cell> => rows[i] ?? []

const columnCount = (rows: ReadonlyArray<ReadonlyArray<Cell>>): number => rowAt(rows, 0).length

const transposedRow = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  col: number,
): ReadonlyArray<Cell> => [cellAt(header, col), ...rows.map((row) => cellAt(row, col))]

const transpose = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  numCols: number,
): ReadonlyArray<ReadonlyArray<Cell>> => {
  const transposed: Array<ReadonlyArray<Cell>> = []
  for (let col = 0; col < numCols; col++) {
    transposed.push(transposedRow(header, rows, col))
  }
  return transposed
}

const flippedRowsText = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number,
  numCols: number,
): string => {
  const transposed = transpose(header, rows, numCols)
  return renderTable(rowAt(transposed, 0), transposed.slice(1), gap)
}

const flippedOrHeaderText = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number,
): string => {
  const numCols = columnCount(rows)
  if (numCols === 0) return header.join('\n')
  return flippedRowsText(header, rows, gap, numCols)
}

const flippedTableText = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number,
): string => {
  if (header.length === 0) return ''
  return flippedOrHeaderText(header, rows, gap)
}

export const renderFlippedTable = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  gap: number = 2,
): string => flippedTableText(header, rows, gap)
