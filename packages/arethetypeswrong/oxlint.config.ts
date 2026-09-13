import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [all],

  overrides: [
    {
      files: ['src/**'],
      rules: { complexity: 'off' },
    },
    {
      files: ['src/**/*.workflow.ts'],
      rules: { complexity: ['error', { max: 1, variant: 'modified' }] },
    },
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
