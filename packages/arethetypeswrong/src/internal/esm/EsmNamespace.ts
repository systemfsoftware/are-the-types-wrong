import type { ModuleFormat } from '@loaderkit/resolve/esm'
import type { Package } from '@systemfsoftware/npm-package'
import type { Exports } from 'cjs-module-lexer'
import { getCjsModuleNamespace } from './CjsNamespace.js'
import { getEsmModuleBindings } from './EsmBindings.js'
import { esmResolve } from './Resolve.js'

// Note: this doesn't handle ambiguous indirect exports which probably isn't worth the
// implementation complexity.

const defaultOnlyBindings: Exports = { exports: ['default'], reexports: [] }

function resolveSeen(seen: Set<string> | undefined): Set<string> {
  return seen ?? new Set<string>()
}

function isEsmModuleFormat(format: ModuleFormat | undefined): boolean {
  return (format ?? 'module') === 'module'
}

function readModuleBindings(fs: Package, url: URL, format: ModuleFormat | undefined): Exports {
  if (!isEsmModuleFormat(format)) {
    return defaultOnlyBindings
  }
  return getEsmModuleBindings(fs.readFile(url.pathname))
}

function readModuleNamespace(fs: Package, url: URL, format: ModuleFormat | undefined, seen: Set<string>): string[] {
  const bindings = readModuleBindings(fs, url, format)

  // Concat indirect exports
  const indirect = bindings.reexports
    .flatMap((specifier) => getEsmModuleNamespace(fs, specifier, url, seen))
    .filter((name) => name !== 'default')
  return [...new Set([...bindings.exports, ...indirect])]
}

function resolvedModuleNamespace(fs: Package, url: URL, format: ModuleFormat | undefined, seen: Set<string>): string[] {
  seen.add(url.pathname)

  if (format === 'commonjs') {
    return [...getCjsModuleNamespace(fs, url)]
  }
  return readModuleNamespace(fs, url, format, seen)
}

function getEsmModuleNamespaceFrom(fs: Package, specifier: string, parentURL: URL, seen: Set<string>): string[] {
  const { format, url } = esmResolve(fs, specifier, parentURL)

  // Don't recurse for circular indirect exports
  if (seen.has(url.pathname)) {
    return []
  }
  return resolvedModuleNamespace(fs, url, format, seen)
}

/** @internal */
export function getEsmModuleNamespace(
  fs: Package,
  specifier: string,
  parentURL = new URL('file:///'),
  seen?: Set<string>,
): string[] {
  return getEsmModuleNamespaceFrom(fs, specifier, parentURL, resolveSeen(seen))
}
