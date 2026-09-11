import { defineConfig } from 'tsdown'

type ExportEntry = string | Record<string, string | undefined>

const typesMap: Record<string, string> = {
  '.': './dist/index.d.ts',
}

const injectTypes = (exports: Record<string, ExportEntry>): Record<string, ExportEntry> => {
  for (const [subpath, types] of Object.entries(typesMap)) {
    const entry = exports[subpath]
    if (typeof entry === 'string') {
      exports[subpath] = { types, default: entry }
      continue
    }
    if (typeof entry !== 'object') continue
    const { default: defaultEntry, types: _existingTypes, ...rest } = entry
    if (typeof defaultEntry === 'string') {
      exports[subpath] = { ...rest, types, default: defaultEntry }
    } else {
      exports[subpath] = { ...rest, types }
    }
  }
  return exports
}

export default defineConfig({
  // The root entry is the whole public surface, and everything a consumer reaches is
  // re-exported from `index.ts`. Declaring `exports` here makes the build own the map, so
  // it cannot drift away from what the package actually emits.
  entry: ['src/index.ts'],
  format: 'esm',
  clean: true,
  exports: { customExports: injectTypes },
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  tsconfig: './tsconfig.build.json',
  deps: {
    neverBundle: [
      'typescript',
      '@loaderkit/resolve',
      '@systemfsoftware/npm-package',
      'cjs-module-lexer',
      'semver',
      'validate-npm-package-name',
    ],
  },
})
