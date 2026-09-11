import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

// House lint surface: the aggregate preset plus the strict TS tier.
export default defineConfig({
  extends: [all],

  rules: {
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'typescript/no-non-null-assertion': 'error',
  },

  overrides: [
    {
      // Gherkin step bodies call expect outside test/it.
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'vitest/no-standalone-expect': 'off' },
    },
    {
      // Build configs are not source: exempt from the node:-import ban.
      files: ['**/vitest.config.ts', '**/tsdown.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
})
