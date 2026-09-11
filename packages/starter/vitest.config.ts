import { defineConfig } from 'vitest/config'

const srcUrl = (module: string): string => new URL(`./src/${module}`, import.meta.url).pathname

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: [{ find: /^@TODO\/starter$/, replacement: srcUrl('index.ts') }],
  },
})
