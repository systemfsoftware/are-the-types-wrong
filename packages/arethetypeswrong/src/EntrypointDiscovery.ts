import { Predicate } from 'effect'

const isSubpathKeyed = (keys: readonly string[]): boolean => keys[0]?.startsWith('.') === true

const subpathsOfRecord = (exportsObject: { readonly [x: PropertyKey]: unknown }): readonly string[] => {
  const keys = Object.keys(exportsObject)
  if (isSubpathKeyed(keys)) return keys.filter((key) => hasExportTarget(exportsObject[key]))
  return keys.flatMap((key) => getSubpaths(exportsObject[key]))
}

export const getSubpaths = (exportsObject: unknown): readonly string[] => {
  if (!Predicate.isObject(exportsObject)) {
    return []
  }
  return subpathsOfRecord(exportsObject)
}

const isBareExportTarget = (value: unknown): boolean => value !== null && value !== undefined

const objectHasExportTarget = (value: unknown): boolean =>
  Predicate.isObject(value) && Object.keys(value).some((key) => hasExportTarget(value[key]))

const structuredExportTarget = (value: object): boolean => {
  if (Array.isArray(value)) return value.some(hasExportTarget)
  return objectHasExportTarget(value)
}

export const hasExportTarget = (exportsObject: unknown): boolean => {
  if (Predicate.isObjectOrArray(exportsObject)) return structuredExportTarget(exportsObject)
  return isBareExportTarget(exportsObject)
}

const isRelativeEntrypoint = (path: string): boolean => path === '.' || path.startsWith('./')

const subpathOrBareEntrypoint = (path: string, packageName: string): string => {
  if (path.startsWith(`${packageName}/`)) return `.${path.slice(packageName.length)}`
  return `./${path}`
}

const selfOrSubpathEntrypoint = (path: string, packageName: string): string => {
  if (path === packageName) return '.'
  return subpathOrBareEntrypoint(path, packageName)
}

const normalizedEntrypoint = (path: string, packageName: string): string => {
  if (isRelativeEntrypoint(path)) return path
  return selfOrSubpathEntrypoint(path, packageName)
}

export const formatEntrypointString = (path: string, packageName: string): string =>
  normalizedEntrypoint(path, packageName).trim()
