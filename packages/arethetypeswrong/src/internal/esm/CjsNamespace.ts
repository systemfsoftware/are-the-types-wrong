import type { ModuleFormat } from '@loaderkit/resolve/esm'
import type { Package } from '@systemfsoftware/npm-package'
import { getCjsModuleBindings } from './CjsBindings.js'
import { cjsResolve } from './Resolve.js'

const noNames: ReadonlySet<string> = new Set()

function isUnseenCommonJs(url: URL, format: ModuleFormat | undefined, seen: Set<string>): boolean {
  return format === 'commonjs' && !seen.has(url.pathname)
}

function resolveReexportedNames(fs: Package, source: string, file: URL, seen: Set<string>): ReadonlySet<string> {
  const { format, url } = cjsResolve(fs, source, file)
  if (!isUnseenCommonJs(url, format, seen)) {
    return noNames
  }
  return getCjsModuleNamespace(fs, url, seen)
}

function collectReexportedNames(fs: Package, source: string, file: URL, seen: Set<string>): ReadonlySet<string> {
  try {
    return resolveReexportedNames(fs, source, file, seen)
  } catch {
    return noNames
  }
}

/** @internal */
export function getCjsModuleNamespace(fs: Package, file: URL, seen = new Set<string>()): Set<string> {
  seen.add(file.pathname)
  const bindings = getCjsModuleBindings(fs.readFile(file.pathname))
  const names = new Set<string>(bindings.exports)

  // CJS always exports `default`
  names.add('default')

  // Additionally, resolve facade reexports

  bindings.reexports.reverse().forEach((source) => {
    collectReexportedNames(fs, source, file, seen).forEach((name) => names.add(name))
  })

  return names
}
