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
  if (options?.entrypoints) {
    return options.entrypoints.map((e) => formatEntrypointString(e, fs.packageName))
  }
  if (exportsObject === undefined) {
    const rootDir = `/node_modules/${fs.packageName}`
    const proxies = getProxyDirectories(rootDir, fs)
    if (proxies.length === 0) {
      if (options?.entrypointsLegacy === true) {
        return fs
          .listFiles()
          .filter((f) => !ts.isDeclarationFileName(f) && extensions.has(f.slice(f.lastIndexOf('.'))))
          .map((f) => '.' + f.slice(rootDir.length))
      }
      return ['.']
    }
    return proxies
  }
  const detectedSubpaths = Match.value(getSubpaths(exportsObject)).pipe(
    Match.when((subpaths) => subpaths.length === 0 && hasExportTarget(exportsObject), () => ['.']),
    Match.orElse((subpaths) => [...subpaths]),
  )
  const included = unique([
    ...detectedSubpaths,
    ...(options?.includeEntrypoints?.map((e) => formatEntrypointString(e, fs.packageName)) ?? []),
  ])
  const excludeEntrypoints = options?.excludeEntrypoints
  if (excludeEntrypoints === undefined) {
    return included
  }
  return included.filter((entrypoint) => {
    return !excludeEntrypoints.some((exclusion) => {
      if (typeof exclusion === 'string') {
        return formatEntrypointString(exclusion, fs.packageName) === entrypoint
      }
      return exclusion.test(entrypoint)
    })
  })
}

function formatEntrypointString(path: string, packageName: string) {
  let formatted: string
  if (path === '.' || path.startsWith('./')) {
    formatted = path
  } else if (path === packageName) {
    formatted = '.'
  } else if (path.startsWith(`${packageName}/`)) {
    formatted = `.${path.slice(packageName.length)}`
  } else {
    formatted = `./${path}`
  }
  return formatted.trim()
}

function getProxyDirectories(rootDir: string, fs: Package) {
  const vendorDirectories = new Set<string>()
  const proxyDirectories: string[] = []
  const files = fs.listFiles().sort((a, b) => a.length - b.length)
  for (const file of files) {
    if (file.startsWith(rootDir) && file.endsWith('/package.json')) {
      try {
        const packageJson: unknown = JSON.parse(fs.readFile(file))
        const packageName: unknown = Object.getOwnPropertyDescriptor(packageJson, 'name')?.value
        if (
          typeof packageName === 'string' &&
          packageName &&
          !packageName.startsWith(fs.packageName)
        ) {
          // Name unrelated to the root package, this is a vendored package
          const vendorDir = file.slice(0, file.lastIndexOf('/'))
          vendorDirectories.add(vendorDir)
        } else if (
          Object.getOwnPropertyDescriptor(packageJson, 'main') !== undefined && !isInsideVendorDirectory(file)
        ) {
          // No name or name starting with root package name, this is intended to be an entrypoint
          const proxyDir = '.' + file.slice(rootDir.length, file.lastIndexOf('/'))
          proxyDirectories.push(proxyDir)
        }
      } catch {}
    }
  }

  return proxyDirectories.sort((a, b) => {
    return ts.comparePathsCaseInsensitive(a, b)
  })

  function isInsideVendorDirectory(file: string) {
    return !!ts.forEachAncestorDirectory(file, (dir) => {
      if (vendorDirectories.has(dir)) {
        return true
      }
    })
  }
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
    const packageJson: unknown = JSON.parse(fs.readFile(`/node_modules/${packageName}/package.json`))
    const exportsObject: unknown = Object.getOwnPropertyDescriptor(packageJson, 'exports')?.value
    let entrypoints = getEntrypoints(fs, exportsObject, options)
    if (companion) {
      const companionPackageJson: unknown = JSON.parse(
        fs.readFile(`/node_modules/${companion.packageName}/package.json`),
      )
      const companionExportsObject: unknown = Object.getOwnPropertyDescriptor(companionPackageJson, 'exports')?.value
      const companionEntrypoints = getEntrypoints(fs, companionExportsObject, options)
      entrypoints = unique([...entrypoints, ...companionEntrypoints])
    }
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
        hasTypes: Object.values(resolutions).some((r) => r.resolution?.isTypeScript === true),
        isWildcard: resolutions.bundler.isWildcard === true,
      }
    }
    return result
  })

const getEntrypointResolution = (
  packageName: string,
  host: CompilerHost,
  resolutionKind: ResolutionKind,
  entrypoint: string,
): Effect.Effect<EntrypointResolutionAnalysis> =>
  Effect.gen(function*() {
    if (entrypoint.includes('*')) {
      return { name: entrypoint, resolutionKind, isWildcard: true }
    }
    const moduleSpecifier = packageName + entrypoint.substring(1)
    let importingFileName: string
    if (resolutionKind === 'node16-esm') {
      importingFileName = '/index.mts'
    } else {
      importingFileName = '/index.ts'
    }
    let resolutionMode: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined
    if (resolutionKind === 'node16-esm') {
      resolutionMode = ts.ModuleKind.ESNext
    } else if (resolutionKind === 'node16-cjs') {
      resolutionMode = ts.ModuleKind.CommonJS
    }
    const resolution = tryResolve()
    const implementationResolution = tryResolve(true)
    let files: string[] | undefined
    if (resolution !== undefined) {
      files = (yield* host.createPrimaryProgram(resolution.fileName)).getSourceFiles().map((f) => f.fileName)
    }

    return {
      name: entrypoint,
      resolutionKind,
      resolution,
      implementationResolution,
      files,
    }

    function tryResolve(noDtsResolution?: boolean): Resolution | undefined {
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
  })
function unique<T>(array: readonly T[]): T[] {
  return array.filter((value, index) => array.indexOf(value) === index)
}
/** @internal */
export function getBuildTools(packageJson: {
  devDependencies?: Record<string, string>
}): Partial<Record<BuildTool, string>> {
  if (!packageJson.devDependencies) {
    return {}
  }
  const result: Partial<Record<BuildTool, string>> = {}
  for (const buildTool of allBuildTools) {
    if (buildTool in packageJson.devDependencies) {
      result[buildTool] = packageJson.devDependencies[buildTool]
    }
  }
  return result
}
/** @internal */
export function getModuleKinds(
  entrypoints: Record<string, EntrypointInfo>,
  resolutionOption: ResolutionOption,
  hosts: CompilerHosts,
): Record<string, ModuleKind> {
  const host = hosts[resolutionOption]
  const result: Record<string, ModuleKind> = {}
  for (const resolutionKind of getResolutionKinds(resolutionOption)) {
    for (const entrypoint of Object.values(entrypoints)) {
      const resolution = entrypoint.resolutions[resolutionKind]
      for (const fileName of resolution.files ?? []) {
        if (!Object.hasOwn(result, fileName)) {
          const moduleKind = host.getModuleKindForFile(fileName)
          if (moduleKind) {
            result[fileName] = moduleKind
          }
        }
      }
      if (resolution.implementationResolution) {
        const fileName = resolution.implementationResolution.fileName
        if (!Object.hasOwn(result, fileName)) {
          const moduleKind = host.getModuleKindForFile(fileName)
          if (moduleKind) {
            result[fileName] = moduleKind
          }
        }
      }
    }
  }
  return result
}
