import { defineConfig } from 'vitest/config'

// Ported from the monorepo's `@systemfsoftware/vitest-config`.
const isAgent = process.env['AGENT'] !== undefined
const isCI = !isAgent && typeof process.env['CI'] === 'string' && process.env['CI'].length > 0
const sharedTestTimeout = isCI ? 30_000 : isAgent ? 15_000 : 8_000

const sharedConfig = {
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    testTimeout: sharedTestTimeout,
    silent: isAgent ? ('passed-only' as const) : false,
    ...(isAgent ? { bail: 1 } : {}),
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'v8' as const,
      reporter: ['json', 'html', 'lcov'] as const,
    },
  },
}

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['tests/**/*.integration.test.ts'],
    globalSetup: ['./tests/__fixtures__/GlobalSetup.ts'],
    passWithNoTests: false,
    includeSource: [],
    coverage: { enabled: false },
    testTimeout: 120_000,
    teardownTimeout: 30_000,
  },
})
