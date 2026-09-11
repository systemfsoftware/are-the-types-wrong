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
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  exports: { devExports: '@systemfsoftware/source', customExports: injectTypes },
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  tsconfig: './tsconfig.build.json',
  deps: {
    neverBundle: ['@systemfsoftware/npm-package'],
  },
})
