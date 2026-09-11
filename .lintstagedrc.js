import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = process.cwd()
const DPRINT = join(ROOT, 'bin/dprint')
const TOLERATE_A_ZERO_FILE_SET = '--no-error-on-unmatched-pattern'

// Each package owns its oxlint config, the way the monorepo does; a staged
// source file lints under its nearest package config, with the runner pointed
// at that package so config discovery and relative resolution behave exactly
// like `pnpm -r lint` from a clean checkout.
//
// Root tooling configs (commitlint, this file) carry no package program: their
// type gate is `tsc -p tsconfig.node.json`. dprint still formats them; the
// staged type-aware run never sees them.
const packageRootOf = (file) => {
  let dir = dirname(join(ROOT, file))
  while (dir.length >= ROOT.length) {
    if (existsSync(join(dir, 'oxlint.config.ts'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,jsx,ts,tsx,mjs,cjs}': (filenames) => {
    const commands = [`${DPRINT} fmt --allow-no-files -- ${filenames.join(' ')}`]
    const byPackage = new Map()
    for (const file of filenames) {
      const packageRoot = packageRootOf(file)
      if (packageRoot === null) continue
      const group = byPackage.get(packageRoot) ?? []
      group.push(relative(packageRoot, join(ROOT, file)))
      byPackage.set(packageRoot, group)
    }
    for (const [packageRoot, files] of byPackage) {
      commands.push(
        `cd ${packageRoot} && oxlint --fix ${TOLERATE_A_ZERO_FILE_SET} --type-aware --type-check --quiet ${
          files.join(' ')
        }`,
      )
    }
    return commands
  },
  '*.{json,jsonc,md,yaml,yml,toml}': (filenames) => [
    `${DPRINT} fmt --allow-no-files -- ${filenames.join(' ')}`,
  ],
}
