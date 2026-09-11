import { defineConfig } from 'vitest/config'

const SETUP_TIMEOUT_MS = 600_000
const TEST_TIMEOUT_MS = 120_000
const SOURCE_CONDITIONS = ['@systemfsoftware/source']

export default defineConfig({
  resolve: { conditions: SOURCE_CONDITIONS },
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: SETUP_TIMEOUT_MS,
    teardownTimeout: 30_000,
    coverage: { enabled: false },
  },
})
