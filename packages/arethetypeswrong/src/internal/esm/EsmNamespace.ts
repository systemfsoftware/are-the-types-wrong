import type { Package } from '@systemfsoftware/npm-package'
import type { Exports } from 'cjs-module-lexer'
import { getCjsModuleNamespace } from './CjsNamespace.js'
import { getEsmModuleBindings } from './EsmBindings.js'
import { esmResolve } from './Resolve.js'

// Note: this doesn't handle ambiguous indirect exports which probably isn't worth the
// implementation complexity.

/** @internal */
export function getEsmModuleNamespace(
  fs: Package,
  specifier: string,
  parentURL = new URL('file:///'),
  seen = new Set<string>(),
): string[] {
  // Resolve specifier
  const { format, url } = esmResolve(fs, specifier, parentURL)

  // Don't recurse for circular indirect exports
  if (seen.has(url.pathname)) {
    return []
  }
  seen.add(url.pathname)

  if (format === 'commonjs') {
    return [...getCjsModuleNamespace(fs, url)]
  }

  // Parse module bindings
  let bindings: Exports
  if ((format ?? 'module') === 'module') {
    bindings = getEsmModuleBindings(fs.readFile(url.pathname))
  } else {
    // Maybe JSON, WASM, etc
    bindings = { exports: ['default'], reexports: [] }
  }

  // Concat indirect exports
  const indirect = bindings.reexports
    .flatMap((specifier) => getEsmModuleNamespace(fs, specifier, url, seen))
    .filter((name) => name !== 'default')
  return [...new Set([...bindings.exports, ...indirect])]
}
