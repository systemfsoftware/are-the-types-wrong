import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { recipes } from '@systemfsoftware/arethetypeswrong-recipes'
import { createPackage, packPackage } from '@systemfsoftware/npm-package'

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url))

const node10ProblemsOnly = () =>
  createPackage(
    {
      'package.json': JSON.stringify({
        name: 'node10-only',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': {
            import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
            require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
          },
        },
      }),
      'dist/index.d.mts': 'export declare const foo: string;\n',
      'dist/index.mjs': 'export const foo = "bar";\n',
      'dist/index.d.cts': 'export declare const foo: string;\n',
      'dist/index.cjs': '"use strict";\nmodule.exports = { foo: "bar" };\n',
    },
    'node10-only',
    '1.0.0',
  )

const TARBALL_BY_PACKAGE = {
  'typed.tgz': recipes.NamedExports,
  'untyped.tgz': recipes.TypesCompanion,
  'false-cjs.tgz': recipes.FalseCJS,
  'typed-node10.tgz': node10ProblemsOnly,
}

const PACK_DIR_FILES = {
  'package.json': JSON.stringify(
    {
      name: 'attw-eval-pack-dir',
      version: '1.0.0',
      main: './index.js',
      types: './index.d.ts',
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
    },
    null,
    2,
  ),
  'index.js': 'module.exports = { a: 1 };\n',
  'index.d.ts': 'export declare const a: number;\nexport declare const b: number;\n',
}

await mkdir(FIXTURES_DIR, { recursive: true })
for (const [name, packPackageCall] of Object.entries(TARBALL_BY_PACKAGE)) {
  await writeFile(join(FIXTURES_DIR, name), packPackage(packPackageCall()))
}

const packDir = join(FIXTURES_DIR, 'pack-dir')
await mkdir(packDir, { recursive: true })
for (const [name, content] of Object.entries(PACK_DIR_FILES)) {
  await writeFile(join(packDir, name), content)
}
