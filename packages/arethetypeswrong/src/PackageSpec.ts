import { Result } from 'effect'
import { valid, validRange } from 'semver'
import validatePackageName from 'validate-npm-package-name'

import { PackageSpecParseError, type ParsedPackageSpec } from './PackageSpec.schema.js'

const malformedScope = (slash: number): boolean => slash === -1 || slash === 1

const scopedSeparatorStart = (input: string): number | undefined => {
  const slash = input.indexOf('/')
  if (malformedScope(slash)) return undefined
  return slash + 1
}

const separatorSearchStart = (input: string): number | undefined => {
  if (!input.startsWith('@')) return 0
  return scopedSeparatorStart(input)
}

interface NameAndVersion {
  readonly name: string
  readonly version: string
}

const splitNameAndVersion = (input: string, separator: number): NameAndVersion => {
  if (separator === -1) return { name: input, version: '' }
  return { name: input.slice(0, separator), version: input.slice(separator + 1) }
}

const rangeOrTag = (version: string): ParsedPackageSpec['versionKind'] => {
  if (validRange(version) !== null) return 'range'
  return 'tag'
}

const versionedKind = (version: string): ParsedPackageSpec['versionKind'] => {
  if (valid(version) !== null) return 'exact'
  return rangeOrTag(version)
}

const versionKindOf = (version: string): ParsedPackageSpec['versionKind'] => {
  if (version === '') return 'none'
  return versionedKind(version)
}

const specFor = (name: string, version: string): ParsedPackageSpec => ({
  versionKind: versionKindOf(version),
  name,
  version,
})

const checkedName = (name: string): Result.Result<string, PackageSpecParseError> => {
  if (validatePackageName(name).errors) {
    return Result.fail(new PackageSpecParseError({ message: 'Invalid package name' }))
  }
  return Result.succeed(name)
}

export const parsePackageSpec = (input: string): Result.Result<ParsedPackageSpec, PackageSpecParseError> => {
  const searchStart = separatorSearchStart(input)
  if (searchStart === undefined) {
    return Result.fail(new PackageSpecParseError({ message: 'Invalid package name' }))
  }
  const { name, version } = splitNameAndVersion(input, input.indexOf('@', searchStart))
  return Result.map(checkedName(name), (validName) => specFor(validName, version))
}
