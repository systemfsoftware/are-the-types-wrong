import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [all],

  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'vitest/no-standalone-expect': 'off' },
    },
    {
      files: ['**/vitest.config.ts', '**/tsdown.config.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
})
