# are-the-types-wrong

> Predictable TypeScript types for npm packages: check entry points, module kinds, and export bindings under every resolution mode Node and bundlers use, before you publish.

A workspace housing the analysis engine and the `attw` CLI behind [arethetypeswrong.github.io](https://arethetypeswrong.github.io).

## Packages

| Package                                                                          | What it is                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`@systemfsoftware/arethetypeswrong-cli`](apps/arethetypeswrong-cli)             | The `attw` command — checks a tarball, a directory, or a published package     |
| [`@systemfsoftware/arethetypeswrong`](packages/arethetypeswrong)                 | The analysis engine, as a library for your own tooling                         |
| [`@systemfsoftware/arethetypeswrong-recipes`](packages/arethetypeswrong-recipes) | Synthetic packages, one per problem kind, that test the engine (not published) |

## Install

Add the CLI to the project you want to check, so your lockfile pins the version:

```bash
pnpm add -D @systemfsoftware/arethetypeswrong-cli
```

> [!NOTE]
> Prefer a lockfile-pinned install over `npx`. A tool whose job is auditing what your package resolves should not itself be resolved fresh from the registry on every run.

## Quick Start

Run the check from the package you want to audit. `--pack` runs `npm pack`, analyzes the resulting tarball, and deletes it:

```bash
pnpm exec attw --pack .
```

A healthy package prints a row per entry point and a column per resolution mode:

```text
No problems found.
Entrypoint  .  ./package.json
node10      ✔  ✔
node16-cjs  ✔  ✔
node16-esm  ✔  ✔
bundler     ✔  ✔
```

Problems replace the `✔` with `✘` and are named above the table, so the exit code can gate CI. Use a [profile](apps/arethetypeswrong-cli/README.md#profiles) when your package deliberately supports only some resolution modes.

## Using the Engine

`checkPackage` returns an Effect, so compose it into your own program and let your edge interpret it once:

```bash
pnpm add @systemfsoftware/arethetypeswrong
```

```ts
import { checkPackage } from '@systemfsoftware/arethetypeswrong'
import { createPackageFromTarballData } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { readFile } from 'node:fs/promises'

const check = Effect.gen(function*() {
  const tarball = yield* Effect.promise(() => readFile('./my-package-1.0.0.tgz'))
  const analysis = yield* checkPackage(createPackageFromTarballData(tarball))

  // analysis.entrypoints — a resolution record per subpath
  // analysis.problems    — what failed, with the position of the offending syntax
  return analysis
})
```

Interpret it once, at the edge of your program: `yield*` it into a larger Effect, or run that Effect with `NodeRuntime.runMain` if it is a script that terminates. Keep one edge — `runMain` sets the exit code and installs the interrupt handlers, and wrapping it in a second runtime leaves the outer edge with no reach over the fibers doing the work.

## What it Checks

The engine simulates how Node and TypeScript resolve each entry point under the `node10`, `node16`, and `bundler` modes:

- **Entry point resolution** — do `exports`, `main`, `types`, and `bin` targets resolve to files that exist?
- **Module kind agreement** — does a file's actual format (ESM, CJS, JSON) match what `type` and its extension imply?
- **Export parity** — do default and named exports line up between the type entry point and the implementation?
- **Unexpected module syntax** — `require`/`module.exports` inside an ESM file, or `import`/`export` inside a CJS file.
- **CJS-only default export** — a CommonJS file whose only export is a default, which `esModuleInterop` consumers receive wrapped.
- **Internal resolution errors** — TypeScript's own resolution failures, reported with the failing specifier and mode.

## Documentation

- [CLI options, config file, and profiles](apps/arethetypeswrong-cli/README.md)
- [Engine API reference](packages/arethetypeswrong/README.md)
- [What each problem kind means](https://github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems)

## Contributing

Development setup, build, and test workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under [Apache-2.0](LICENSE).
