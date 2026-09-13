import type { Package } from '@systemfsoftware/npm-package'
import { Effect, Match } from 'effect'
import ts from 'typescript'
import type { CheckPackageOptions } from '../CheckPackage.js'
import { getSubpaths, hasExportTarget } from '../EntrypointDiscovery.js'
import type {
  BuildTool,
  EntrypointInfo,
  EntrypointResolutionAnalysis,
  ModuleKind,
  Resolution,
  ResolutionKind,
  ResolutionOption,
} from '../Types.js'
import type { TypesCompanionInfo } from '../TypesCompanion.js'
import { allBuildTools, getResolutionKinds, isNonEmptyString } from '../Utils.js'
import { type CompilerHost, type CompilerHosts } from './MultiCompilerHost.js'

const extensions = new Set(['.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.mts', '.cjs'])

function getEntrypoints(fs: Package, exportsObject: unknown, options: CheckPackageOptions | undefined): string[] {
  return getConfiguredEntrypoints(fs, exportsObject, options) ?? getLegacyEntrypoints(fs, options)
}

function getConfiguredEntrypoints(
  fs: Package,
  exportsObject: unknown,
  options: CheckPackageOptions | undefined,
): string[] | undefined {
  return getNamedEntrypoints(options, fs.packageName) ?? getExportsObjectEntrypoints(fs, exportsObject, options)
}

function getNamedEntrypoints(options: CheckPackageOptions | undefined, packageName: string): string[] | undefined {
  return formatEntrypointList(getOptionEntrypoints(options, 'entrypoints'), packageName)
}

function getIncludedEntrypoints(options: CheckPackageOptions | undefined, packageName: string): string[] {
  return formatEntrypointList(getOptionEntrypoints(options, 'includeEntrypoints'), packageName) ?? []
}

function getOptionEntrypoints(
  options: CheckPackageOptions | undefined,
  key: 'entrypoints' | 'includeEntrypoints',
): readonly string[] | undefined {
  return options?.[key]
}

function formatEntrypointList(entrypoints: readonly string[] | undefined, packageName: string): string[] | undefined {
  if (entrypoints === undefined) {
    return undefined
  }
  return entrypoints.map((entrypoint) => formatEntrypointString(entrypoint, packageName))
}

function getExportsObjectEntrypoints(
  fs: Package,
  exportsObject: unknown,
  options: CheckPackageOptions | undefined,
): string[] | undefined {
  if (exportsObject === undefined) {
    return undefined
  }
  return getEntrypointsFromExportsObject(fs, exportsObject, options)
}

function getLegacyEntrypoints(fs: Package, options: CheckPackageOptions | undefined): string[] {
  const rootDir = `/node_modules/${fs.packageName}`
  const proxies = getProxyDirectories(rootDir, fs)
  if (proxies.length === 0) {
    return getUnnamedEntrypoints(fs, rootDir, options)
  }
  return proxies
}

function getUnnamedEntrypoints(fs: Package, rootDir: string, options: CheckPackageOptions | undefined): string[] {
  if (isLegacyEntrypointsOption(options)) {
    return getDeclaredFileEntrypoints(fs, rootDir)
  }
  return ['.']
}

function isLegacyEntrypointsOption(options: CheckPackageOptions | undefined): boolean {
  return options?.entrypointsLegacy === true
}

function getDeclaredFileEntrypoints(fs: Package, rootDir: string): string[] {
  return fs.listFiles()
    .filter((file) => !ts.isDeclarationFileName(file) && extensions.has(file.slice(file.lastIndexOf('.'))))
    .map((file) => '.' + file.slice(rootDir.length))
}

function getEntrypointsFromExportsObject(
  fs: Package,
  exportsObject: unknown,
  options: CheckPackageOptions | undefined,
): string[] {
  const detectedSubpaths = Match.value(getSubpaths(exportsObject)).pipe(
    Match.when((subpaths) => subpaths.length === 0 && hasExportTarget(exportsObject), () => ['.']),
    Match.orElse((subpaths) => [...subpaths]),
  )
  const included = unique([...detectedSubpaths, ...getIncludedEntrypoints(options, fs.packageName)])
  return filterExcludedEntrypoints(included, options?.excludeEntrypoints, fs.packageName)
}

function filterExcludedEntrypoints(
  entrypoints: string[],
  excludeEntrypoints: readonly (string | RegExp)[] | undefined,
  packageName: string,
): string[] {
  if (excludeEntrypoints === undefined) {
    return entrypoints
  }
  return entrypoints.filter((entrypoint) => !isExcludedEntrypoint(entrypoint, excludeEntrypoints, packageName))
}

function isExcludedEntrypoint(
  entrypoint: string,
  exclusions: readonly (string | RegExp)[],
  packageName: string,
): boolean {
  return exclusions.some((exclusion) => matchesExclusion(entrypoint, exclusion, packageName))
}

function matchesExclusion(entrypoint: string, exclusion: string | RegExp, packageName: string): boolean {
  if (typeof exclusion === 'string') {
    return formatEntrypointString(exclusion, packageName) === entrypoint
  }
  return exclusion.test(entrypoint)
}

function formatEntrypointString(path: string, packageName: string): string {
  return formatEntrypointPath(path, packageName).trim()
}

function formatEntrypointPath(path: string, packageName: string): string {
  return Match.value(path).pipe(
    Match.when(isRelativeSpecifier, (relativePath) => relativePath),
    Match.when((candidate) => candidate === packageName, () => '.'),
    Match.when(
      (candidate) => candidate.startsWith(`${packageName}/`),
      (subpath) => `.${subpath.slice(packageName.length)}`,
    ),
    Match.orElse((barePath) => `./${barePath}`),
  )
}

function isRelativeSpecifier(path: string): boolean {
  return path === '.' || path.startsWith('./')
}

interface ProxyDirectoryState {
  readonly vendorDirectories: Set<string>
  readonly proxyDirectories: string[]
}

function getProxyDirectories(rootDir: string, fs: Package): string[] {
  const state: ProxyDirectoryState = { vendorDirectories: new Set(), proxyDirectories: [] }
  for (const file of getPackageJsonFiles(rootDir, fs)) {
    collectProxyDirectory(state, file, rootDir, fs)
  }
  return state.proxyDirectories.sort((first, second) => ts.comparePathsCaseInsensitive(first, second))
}

function getPackageJsonFiles(rootDir: string, fs: Package): string[] {
  return fs.listFiles()
    .filter((file) => isPackageJsonInsideRoot(file, rootDir))
    .sort((first, second) => first.length - second.length)
}

function isPackageJsonInsideRoot(file: string, rootDir: string): boolean {
  return file.startsWith(rootDir) && file.endsWith('/package.json')
}

function collectProxyDirectory(state: ProxyDirectoryState, file: string, rootDir: string, fs: Package): void {
  try {
    recordPackageJsonDirectory(state, file, rootDir, fs)
  } catch {}
}

function recordPackageJsonDirectory(state: ProxyDirectoryState, file: string, rootDir: string, fs: Package): void {
  const packageJson: unknown = JSON.parse(fs.readFile(file))
  if (isVendoredPackageName(getPackageJsonProperty(packageJson, 'name'), fs.packageName)) {
    state.vendorDirectories.add(file.slice(0, file.lastIndexOf('/')))
    return
  }
  recordProxyDirectory(state, packageJson, file, rootDir)
}

function getPackageJsonProperty(packageJson: unknown, key: string): unknown {
  return Object.getOwnPropertyDescriptor(packageJson, key)?.value
}

function isVendoredPackageName(packageName: unknown, rootPackageName: string): boolean {
  return typeof packageName === 'string' && isUnrelatedPackageName(packageName, rootPackageName)
}

function isUnrelatedPackageName(packageName: string, rootPackageName: string): boolean {
  return packageName !== '' && !packageName.startsWith(rootPackageName)
}

function recordProxyDirectory(
  state: ProxyDirectoryState,
  packageJson: unknown,
  file: string,
  rootDir: string,
): void {
  if (!isIntendedEntrypoint(packageJson, file, state.vendorDirectories)) {
    return
  }
  state.proxyDirectories.push('.' + file.slice(rootDir.length, file.lastIndexOf('/')))
}

function isIntendedEntrypoint(packageJson: unknown, file: string, vendorDirectories: Set<string>): boolean {
  return getPackageJsonProperty(packageJson, 'main') !== undefined && !isInsideVendorDirectory(file, vendorDirectories)
}

function isInsideVendorDirectory(file: string, vendorDirectories: Set<string>): boolean {
  return !!ts.forEachAncestorDirectory(file, (directory) => {
    if (vendorDirectories.has(directory)) {
      return true
    }
    return undefined
  })
}

/** @internal */
export const getEntrypointInfo = (
  packageName: string,
  fs: Package,
  hosts: CompilerHosts,
  options: CheckPackageOptions | undefined,
  companion?: TypesCompanionInfo,
): Effect.Effect<Record<string, EntrypointInfo>> =>
  Effect.gen(function*() {
    const entrypoints = getEntrypointList(packageName, fs, options, companion)
    const result: Record<string, EntrypointInfo> = {}
    for (const entrypoint of entrypoints) {
      const resolutions: Record<ResolutionKind, EntrypointResolutionAnalysis> = {
        node10: yield* getEntrypointResolution(packageName, hosts.node10, 'node10', entrypoint),
        'node16-cjs': yield* getEntrypointResolution(packageName, hosts.node16, 'node16-cjs', entrypoint),
        'node16-esm': yield* getEntrypointResolution(packageName, hosts.node16, 'node16-esm', entrypoint),
        bundler: yield* getEntrypointResolution(packageName, hosts.bundler, 'bundler', entrypoint),
      }
      result[entrypoint] = {
        subpath: entrypoint,
        resolutions,
        hasTypes: Object.values(resolutions).some((resolution) => resolution.resolution?.isTypeScript === true),
        isWildcard: resolutions.bundler.isWildcard === true,
      }
    }
    return result
  })

function getEntrypointList(
  packageName: string,
  fs: Package,
  options: CheckPackageOptions | undefined,
  companion: TypesCompanionInfo | undefined,
): string[] {
  const entrypoints = getEntrypoints(fs, readExportsObject(fs, packageName), options)
  if (companion === undefined) {
    return entrypoints
  }
  return unique([...entrypoints, ...getCompanionEntrypoints(fs, options, companion)])
}

function getCompanionEntrypoints(
  fs: Package,
  options: CheckPackageOptions | undefined,
  companion: TypesCompanionInfo,
): string[] {
  return getEntrypoints(fs, readExportsObject(fs, companion.packageName), options)
}

function readExportsObject(fs: Package, packageName: string): unknown {
  const packageJson: unknown = JSON.parse(fs.readFile(`/node_modules/${packageName}/package.json`))
  return Object.getOwnPropertyDescriptor(packageJson, 'exports')?.value
}

const getEntrypointResolution = (
  packageName: string,
  host: CompilerHost,
  resolutionKind: ResolutionKind,
  entrypoint: string,
): Effect.Effect<EntrypointResolutionAnalysis> => {
  if (isWildcardEntrypoint(entrypoint)) {
    return Effect.succeed({ name: entrypoint, resolutionKind, isWildcard: true })
  }
  return resolveEntrypoint(packageName, host, resolutionKind, entrypoint)
}

function isWildcardEntrypoint(entrypoint: string): boolean {
  return entrypoint.includes('*')
}

const resolveEntrypoint = (
  packageName: string,
  host: CompilerHost,
  resolutionKind: ResolutionKind,
  entrypoint: string,
): Effect.Effect<EntrypointResolutionAnalysis> =>
  Effect.gen(function*() {
    const moduleSpecifier = packageName + entrypoint.substring(1)
    const importingFileName = importingFileNameFor(resolutionKind)
    const resolutionMode = resolutionModeFor(resolutionKind)
    const resolution = tryResolveModule(host, moduleSpecifier, importingFileName, resolutionMode, false)
    const implementationResolution = tryResolveModule(host, moduleSpecifier, importingFileName, resolutionMode, true)
    const files = yield* getProgramFiles(host, resolution)
    return {
      name: entrypoint,
      resolutionKind,
      resolution,
      implementationResolution,
      files,
    }
  })

function importingFileNameFor(resolutionKind: ResolutionKind): string {
  if (resolutionKind === 'node16-esm') {
    return '/index.mts'
  }
  return '/index.ts'
}

function resolutionModeFor(
  resolutionKind: ResolutionKind,
): ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined {
  if (resolutionKind === 'node16-esm') {
    return ts.ModuleKind.ESNext
  }
  return commonJsResolutionModeFor(resolutionKind)
}

function commonJsResolutionModeFor(resolutionKind: ResolutionKind): ts.ModuleKind.CommonJS | undefined {
  if (resolutionKind === 'node16-cjs') {
    return ts.ModuleKind.CommonJS
  }
  return undefined
}

function tryResolveModule(
  host: CompilerHost,
  moduleSpecifier: string,
  importingFileName: string,
  resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined,
  noDtsResolution: boolean,
): Resolution | undefined {
  const { resolution, trace } = host.resolveModuleName(
    moduleSpecifier,
    importingFileName,
    resolutionMode,
    noDtsResolution,
  )
  const resolvedModule = resolution.resolvedModule
  if (resolvedModule === undefined) {
    return undefined
  }
  return getResolution(resolvedModule, trace)
}

function getResolution(resolvedModule: ts.ResolvedModuleFull, trace: string[]): Resolution | undefined {
  const fileName = resolvedModule.resolvedFileName
  if (!isNonEmptyString(fileName)) {
    return undefined
  }
  return {
    fileName,
    isJson: resolvedModule.extension === ts.Extension.Json,
    isTypeScript: ts.hasTSFileExtension(resolvedModule.resolvedFileName),
    trace,
  }
}

function getProgramFiles(
  host: CompilerHost,
  resolution: Resolution | undefined,
): Effect.Effect<string[] | undefined> {
  if (resolution === undefined) {
    return Effect.succeed(undefined)
  }
  return Effect.map(
    host.createPrimaryProgram(resolution.fileName),
    (program) => program.getSourceFiles().map((file) => file.fileName),
  )
}

function unique<T>(array: readonly T[]): T[] {
  return array.filter((value, index) => array.indexOf(value) === index)
}

/** @internal */
export function getBuildTools(packageJson: {
  devDependencies?: Record<string, string>
}): Partial<Record<BuildTool, string>> {
  const devDependencies = packageJson.devDependencies
  if (devDependencies === undefined) {
    return {}
  }
  return getBuildToolVersions(devDependencies)
}

function getBuildToolVersions(devDependencies: Record<string, string>): Partial<Record<BuildTool, string>> {
  return Object.fromEntries(
    allBuildTools
      .filter((buildTool) => buildTool in devDependencies)
      .map((buildTool) => [buildTool, devDependencies[buildTool]]),
  )
}

/** @internal */
export function getModuleKinds(
  entrypoints: Record<string, EntrypointInfo>,
  resolutionOption: ResolutionOption,
  hosts: CompilerHosts,
): Record<string, ModuleKind> {
  const host = hosts[resolutionOption]
  const result: Record<string, ModuleKind> = {}
  for (const fileName of getResolutionFileNames(entrypoints, resolutionOption)) {
    recordModuleKind(host, result, fileName)
  }
  return result
}

function getResolutionFileNames(
  entrypoints: Record<string, EntrypointInfo>,
  resolutionOption: ResolutionOption,
): string[] {
  return getResolutionKinds(resolutionOption).flatMap((resolutionKind) =>
    Object.values(entrypoints).flatMap((entrypoint) => getEntrypointFileNames(entrypoint, resolutionKind))
  )
}

function getEntrypointFileNames(entrypoint: EntrypointInfo, resolutionKind: ResolutionKind): string[] {
  const resolution = entrypoint.resolutions[resolutionKind]
  const implementationResolution = resolution.implementationResolution
  const files = getDeclaredResolutionFiles(resolution)
  if (implementationResolution === undefined) {
    return [...files]
  }
  return [...files, implementationResolution.fileName]
}

function getDeclaredResolutionFiles(resolution: EntrypointResolutionAnalysis): string[] {
  return resolution.files ?? []
}

function recordModuleKind(host: CompilerHost, result: Record<string, ModuleKind>, fileName: string): void {
  const moduleKind = getUnrecordedModuleKind(host, result, fileName)
  if (moduleKind !== undefined) {
    result[fileName] = moduleKind
  }
}

function getUnrecordedModuleKind(
  host: CompilerHost,
  result: Record<string, ModuleKind>,
  fileName: string,
): ModuleKind | undefined {
  if (Object.hasOwn(result, fileName)) {
    return undefined
  }
  return host.getModuleKindForFile(fileName)
}
