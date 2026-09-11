const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getSubpaths = (exportsObject: unknown): readonly string[] => {
  if (!isRecord(exportsObject)) {
    return []
  }
  const keys = Object.keys(exportsObject)
  if (keys[0]?.startsWith('.')) {
    return keys.filter((key) => hasExportTarget(exportsObject[key]))
  }
  return keys.flatMap((key) => getSubpaths(exportsObject[key]))
}

export const hasExportTarget = (exportsObject: unknown): boolean => {
  if (exportsObject === null || exportsObject === undefined) {
    return false
  }
  if (typeof exportsObject !== 'object') {
    return true
  }
  if (Array.isArray(exportsObject)) {
    return exportsObject.some(hasExportTarget)
  }
  return isRecord(exportsObject) && Object.keys(exportsObject).some((key) => hasExportTarget(exportsObject[key]))
}

export const formatEntrypointString = (path: string, packageName: string): string => {
  let normalized: string
  if (path === '.' || path.startsWith('./')) {
    normalized = path
  } else if (path === packageName) {
    normalized = '.'
  } else if (path.startsWith(`${packageName}/`)) {
    normalized = `.${path.slice(packageName.length)}`
  } else {
    normalized = `./${path}`
  }
  return normalized.trim()
}
