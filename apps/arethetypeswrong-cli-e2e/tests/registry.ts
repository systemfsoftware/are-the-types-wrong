export const REGISTRY_FIXTURE_NAME = 'attw-fixture-pkg'
export const REGISTRY_FIXTURE_VERSION = '1.0.0'

export const REGISTRY_FIXTURE_FILES = {
  'package.json': JSON.stringify(
    {
      name: REGISTRY_FIXTURE_NAME,
      version: REGISTRY_FIXTURE_VERSION,
      main: 'index.js',
      types: 'index.d.ts',
    },
    null,
    2,
  ),
  'index.js': 'module.exports = { value: 1 }\n',
  'index.d.ts': 'export declare const value: number\n',
} as const
