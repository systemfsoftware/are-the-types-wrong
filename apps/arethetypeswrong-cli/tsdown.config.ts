import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  platform: 'node',
  shims: true,
  dts: false,
  outExtensions: () => ({ js: '.mjs' }),
  tsconfig: './tsconfig.build.json',
  deps: {
    alwaysBundle: [/./],
    onlyImport: [/^node:/],
    onlyBundle: false,
  },
})
