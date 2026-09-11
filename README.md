# are-the-types-wrong

> Predictable TypeScript type definitions for npm packages: check entry points, module kinds, and export bindings across Node and bundler resolution modes before publishing.

An Effect-powered workspace and monorepo housing the core analysis engine and CLI for checking TypeScript types and packaging conventions in npm distributions.

## Packages

| Package                                                                          | Version | Description                                                                      |
| -------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| [`@systemfsoftware/arethetypeswrong-cli`](packages/arethetypeswrong-cli)         | `4.0.0` | Official CLI tool (`attw`) to check local tarballs, directories, or npm packages |
| [`@systemfsoftware/arethetypeswrong`](packages/arethetypeswrong)                 | `7.0.0` | Programmatic analysis engine behind arethetypeswrong.github.io                   |
| [`@systemfsoftware/arethetypeswrong-recipes`](packages/arethetypeswrong-recipes) | `0.1.0` | Problem-class recipes and fixture generation for attw tests                      |

## Quick Start

Check a package tarball or local directory without global installation:

```bash
npx @systemfsoftware/arethetypeswrong-cli --pack .
```

Or check an already-published npm package:

```bash
npx @systemfsoftware/arethetypeswrong-cli --from-npm @systemfsoftware/arethetypeswrong-cli
```

To use the programmatic engine in a TypeScript or JavaScript project:

```bash
pnpm add @systemfsoftware/arethetypeswrong
```

```ts
import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { createPackageFromTarballData } from '@systemfsoftware/npm-package'
import { readFile } from 'node:fs/promises'

const tarball = await readFile('./my-package-1.0.0.tgz')
const pkg = createPackageFromTarballData(tarball)
const analysis = await checkPackage(pkg)
```

## What it Checks

`are-the-types-wrong` simulates how Node and TypeScript resolve types and implementations under `node10`, `node16`, and `bundler` resolution modes:

- **Entry point resolution**: Verifies `exports`, `main`, `types`, and `bin` paths map to existing files.
- **Module kind agreement**: Ensures dual-package files match their designated formats (`ESM` vs `CJS`).
- **Export default & named export parity**: Detects mismatches between type definitions and JavaScript implementation exports.
- **Unexpected module syntax**: Catches CJS constructs (`require`, `module.exports`) in ESM and ESM constructs (`import`, `export`) in CJS files.
- **CJS-only default export**: Flags default exports that require `esModuleInterop` workarounds.

## Output Matrix

When running `attw`, results are formatted as a compatibility matrix across resolution modes:

```text
┌───────────────────┬──────────────────────┬──────────────────────┬─────────┐
│ Entrypoint        │ node10               │ node16 (node)        │ bundler │
├───────────────────┼──────────────────────┼──────────────────────┼─────────┤
│ .                 │ 🟢 (CJS)             │ 🟢 (ESM)             │ 🟢      │
│ ./utils           │ 🟢 (CJS)             │ 🟢 (ESM)             │ 🟢      │
└───────────────────┴──────────────────────┴──────────────────────┴─────────┘
```

## Documentation

- [CLI Documentation & Options](packages/arethetypeswrong-cli/README.md)
- [Core Engine API Reference](packages/arethetypeswrong/README.md)
- [Explanation of Problem Kinds](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/NoResolution.md)

## Contributing

Development setup, test execution, and CI workflow details: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under [Apache-2.0](LICENSE).
