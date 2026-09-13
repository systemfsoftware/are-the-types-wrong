export type AnsiColor =
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'gray'
  | 'white'

export type AnsiAnnotation = {
  readonly color?: AnsiColor
  readonly bold?: boolean
}

const colorCode = (c: AnsiColor): string => {
  switch (c) {
    case 'red':
      return '31'
    case 'green':
      return '32'
    case 'yellow':
      return '33'
    case 'blue':
      return '34'
    case 'magenta':
      return '35'
    case 'cyan':
      return '36'
    case 'gray':
      return '90'
    case 'white':
      return '37'
  }
}

const isStyled = (anno: AnsiAnnotation): boolean => anno.bold === true || anno.color !== undefined

const boldPart = (anno: AnsiAnnotation): readonly string[] => {
  if (anno.bold === true) return ['1']
  return []
}

const colorPart = (anno: AnsiAnnotation): readonly string[] => {
  if (anno.color === undefined) return []
  return [colorCode(anno.color)]
}

export const annotate = (text: string, anno: AnsiAnnotation): string => {
  if (!isStyled(anno)) return text
  return `\u001b[${[...boldPart(anno), ...colorPart(anno)].join(';')}m${text}\u001b[0m`
}

// The escape is built, not written as a literal: a control character inside a
// regex literal is invisible in a diff.
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g')

export const stripAnsi = (text: string): string => text.replace(ANSI_SEQUENCE, '')

const replaceMarker = (out: string, marker: string, anno: AnsiAnnotation): string => {
  if (!out.includes(marker)) return out
  return out.split(marker).join(annotate(marker, anno))
}

const colorizeMarkers = (cell: string, annotations: Record<string, AnsiAnnotation>): string => {
  let out = cell
  for (const [marker, anno] of Object.entries(annotations)) {
    out = replaceMarker(out, marker, anno)
  }
  return out
}

export const colorizeCell = (
  cell: string,
  color: boolean,
  annotations: Record<string, AnsiAnnotation>,
): string => {
  if (!color) return cell
  return colorizeMarkers(cell, annotations)
}
