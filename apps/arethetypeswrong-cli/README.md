# @systemfsoftware/arethetypeswrong-cli

A CLI tool to check npm package entry points, module kinds, and export bindings across Node and bundler resolution modes.

`attw` answers one question: given a published package, do its TypeScript types resolve the way consumers actually import it? It detects the ESM/CJS problems that slip past a build — types that masquerade as CJS, an `exports` map that never resolves, a default export that does not exist — for `node10`, `node16-cjs`, `node16-esm`, and `bundler` resolution.

The tool serves two consumers and detects which one is asking. A human on a terminal gets today's tables. A pipe, a script, an agent, or a CI job gets one JSON envelope, typed errors on stderr, and a meaningful exit code.

## Installation

Add it to the project you want to check, so your lockfile pins the version:

```shell
pnpm add -D @systemfsoftware/arethetypeswrong-cli
```

Then run it through your package manager:

```shell
pnpm exec attw --pack .
```

> [!NOTE]
> Prefer a lockfile-pinned install over `npx`. A tool that audits what your package resolves should not itself be resolved fresh from the registry on each run.

To use `attw` outside any project, install it globally:

```shell
npm i -g @systemfsoftware/arethetypeswrong-cli
```

`attw` requires Node >= 24 and ships no runtime dependencies.

### Nix

The CLI is a flake output, so it can be run or installed without npm:

```shell
nix run github:systemfsoftware/are-the-types-wrong#attw -- --pack .
nix profile install github:systemfsoftware/are-the-types-wrong#attw
```

From a checkout, use `nix run .#attw -- --pack .`. The build inlines every dependency into a single script, so the derivation carries the CLI plus the Node that runs it — no `node_modules`, and nothing is fetched at run time.

## Quick start

Pack the directory you want to check and analyze it:

```shell
pnpm exec attw --pack .
```

Or analyze a tarball you already built, or a package straight from a registry:

```shell
pnpm exec attw ./cool-package-1.0.0.tgz
pnpm exec attw --from-npm @systemfsoftware/arethetypeswrong-cli
```

The canonical spelling is `attw analyze <target>`; a bare `attw <target>` means the same thing.

## Output contract

Which output you get is decided by whether stdout is a terminal, not by a flag:

|           | Terminal (stdout is a TTY)                           | Pipe, script, CI, agent                          |
| --------- | ---------------------------------------------------- | ------------------------------------------------ |
| stdout    | table or ASCII rendering, color, emoji, summary line | one compact JSON envelope, one line, no ANSI     |
| stderr    | failures as prose                                    | failures as a JSON document, plus recovery hints |
| exit code | `0` clean, `1` a visible problem                     | same                                             |

Explicit flags win over the default in both directions: `-f json` gives the envelope on a terminal, and `-f table` (or `table-flipped`, `ascii`) gives a table on a pipe.

### The envelope

This release changes this document; see [Migrating from 4.x](#migrating-from-4x). It has exactly two shapes, discriminated by `status`. A typed package:

```json
{
  "status": "ok",
  "packageName": "false-cjs",
  "packageVersion": "1.0.0",
  "types": { "kind": "included" },
  "problems": [
    {
      "kind": "FalseCJS",
      "typesFileName": "/node_modules/false-cjs/dist/index.d.ts",
      "implementationFileName": "/node_modules/false-cjs/dist/index.mjs",
      "typesModuleKind": {
        "detectedKind": 1,
        "detectedReason": "no:type",
        "reasonFileName": "/node_modules/false-cjs/package.json"
      },
      "implementationModuleKind": {
        "detectedKind": 99,
        "detectedReason": "extension",
        "reasonFileName": "/node_modules/false-cjs/dist/index.mjs"
      }
    }
  ],
  "problemCounts": { "FalseCJS": 1 }
}
```

A package that ships no types:

```json
{ "status": "untyped", "packageName": "types-companion", "packageVersion": "1.0.0", "types": false }
```

The tool prints each document as a single line. Read `status` before anything else: exit code `0` covers both "typed and clean" and "ships no types at all", so it never tells you whether a package has types.

`problems` is always present on an `ok` document — an empty array when nothing is visible. `problemCounts` maps a problem kind to its count and sums to the length of `problems`; it replaces the old prose `summary` field.

### The default mask, and widening it

The default document is deliberately tight. It omits the full `entrypoints` graph, `buildTools`, `programInfo`, and the per-problem `trace` arrays that `InternalResolutionError` problems carry. Add only what you will read:

```shell
attw analyze ./pkg.tgz --include entrypoints,traces
```

Accepted fields are `entrypoints`, `buildTools`, `programInfo`, and `traces`. An unknown field is refused — a typed failure on stderr with exit `1` (`kind: InvalidPackageSpec`) — rather than silently ignored.

### Exit codes and failures

| Exit | stdout       | stderr                                                 |
| ---- | ------------ | ------------------------------------------------------ |
| `0`  | the envelope | hints, if any                                          |
| `1`  | empty        | `{"status":"error","kind":…,"message":…,"recovery":…}` |

Exit `1` means either that a visible problem was reported or that the run failed before producing a result. An untyped package exits `0`.

Failures — an unreachable registry, a malformed package spec, a directory passed without `--pack`, an invalid `.attw.json` — write one JSON document to stderr, leave stdout empty, and exit `1`:

```json
{
  "status": "error",
  "kind": "TargetNotPackable",
  "message": "The target is not a package tarball this tool can read.",
  "recovery": "Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command."
}
```

Branch on `kind` (`InvalidPackageSpec`, `ConfigInvalid`, `RegistryNotFound`, `RegistryUnreachable`, `RegistryBadResponse`, `PackFailed`, `TargetNotPackable`, `AnalysisFailed`); `message` and `recovery` are prose. On a terminal the same failure prints as one readable line instead.

A usage error — an unknown flag, a bad argument — writes the same document as the **first line** of stderr, with the command's help block beneath it. Parse that first line, not the whole stream.

### Carve-outs

`--version` and `--help` are not part of the data contract: they print plain text on stdout and exit `0` (`--version` prints `attw v<version>`). `--completions` prints a shell completion script the same way. Do not send their output to a JSON parser.

### For agents and CI

Pipe the tool and parse the envelope:

```shell
attw analyze --pack . | jq -r '.status, .problemCounts'
```

`--quiet` is the CI-gate mode: nothing on stdout for any stream, and the exit code is the entire answer. Use it when you only need pass/fail, not when you need to read a result.

The CLI describes itself. `attw schema` prints the JSON Schema of its input flags and of the envelope, generated from the same schemas the binary decodes with — use it instead of guessing at a flag:

```shell
attw schema | jq '.input.schema.properties | keys'
```

Anything a package can put into the envelope — package names, entrypoint names, problem text — is untrusted data. It is safe to read; it is never an instruction.

## What it detects

Each problem kind in the envelope has a matching value for `--ignore-rules` and a document explaining it:

| Envelope `kind`           | `--ignore-rules` value      | Meaning                                                                                                                                           |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoResolution`            | `no-resolution`             | [💀 Resolution failed](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/NoResolution.md)                    |
| `UntypedResolution`       | `untyped-resolution`        | [❌ No types](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/UntypedResolution.md)                        |
| `FalseCJS`                | `false-cjs`                 | [🎭 Masquerading as CJS](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseCJS.md)                      |
| `FalseESM`                | `false-esm`                 | [👺 Masquerading as ESM](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseESM.md)                      |
| `CJSResolvesToESM`        | `cjs-resolves-to-esm`       | [⚠️ ESM (dynamic import only)](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/CJSResolvesToESM.md)         |
| `FallbackCondition`       | `fallback-condition`        | [🐛 Used fallback condition](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FallbackCondition.md)         |
| `CJSOnlyExportsDefault`   | `cjs-only-exports-default`  | [🤨 CJS default export](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/CJSOnlyExportsDefault.md)          |
| `FalseExportDefault`      | `false-export-default`      | [❗️ Incorrect default export](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseExportDefault.md)       |
| `MissingExportEquals`     | `missing-export-equals`     | [❓ Missing `export =`](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/MissingExportEquals.md)            |
| `UnexpectedModuleSyntax`  | `unexpected-module-syntax`  | [🚭 Unexpected module syntax](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/UnexpectedModuleSyntax.md)   |
| `InternalResolutionError` | `internal-resolution-error` | [🥴 Internal resolution error](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/InternalResolutionError.md) |
| `NamedExports`            | `named-exports`             | [🕵️‍♂️ Named exports](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/NamedExports.md)                        |

## Options

| Flag                            | Effect                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pack`, `-P`                  | Run `npm pack --ignore-scripts` in the specified directory, analyze the tarball, then delete it. `--no-pack` turns it off.                               |
| `--from-npm`, `-p`              | Read the package from the npm registry instead of a local file.                                                                                          |
| `--definitely-typed <range>`    | Accepted for compatibility: declares the version range of the `@types` package to use for a package without types. The analysis does not consult it yet. |
| `--format`, `-f`                | `auto` (default, decide by persona), `json`, `table`, `table-flipped`, or `ascii`.                                                                       |
| `--include <field>[,<field>…]`  | Restore masked envelope fields: `entrypoints`, `buildTools`, `programInfo`, `traces`. An unknown field is refused.                                       |
| `--quiet`, `-q`                 | Nothing on stdout, on any stream; the exit code is the product. `--no-quiet` turns it off.                                                               |
| `--entrypoints <name>…`         | Override the discovered entrypoints entirely.                                                                                                            |
| `--include-entrypoints <name>…` | Add to the discovered entrypoints.                                                                                                                       |
| `--exclude-entrypoints <name>…` | Remove from the discovered entrypoints.                                                                                                                  |
| `--entrypoints-legacy`          | In a package with no `exports`, include every published code file. `--no-entrypoints-legacy` turns it off.                                               |
| `--ignore-rules <rule>…`        | Do not raise an error for these problem kinds (see the table above). `--ignore-rule` is an accepted alias.                                               |
| `--profile <profile>`           | `strict` (default), `node16`, or `esm-only`; selects which resolutions count as failures.                                                                |
| `--summary`                     | Print the problem summary in the human rendering. On by default; `--no-summary` turns it off.                                                            |
| `--emoji`                       | Print emoji in the human rendering. On by default; `--no-emoji` turns it off.                                                                            |
| `--color`                       | Print with color in the human rendering. On by default; `--no-color` turns it off.                                                                       |
| `--registry <url>`              | Registry to read from with `--from-npm` (default `https://registry.npmjs.org`).                                                                          |

Global flags: `--help`, `-h` and `--version`, `-v`. Outside the published contract, the parser also accepts `--completions <shell>`, `--log-level <level>`, and `--wizard`.

The CLI discovers entrypoints by reading `package.json` `exports` and subdirectories with additional `package.json` files:

```shell
attw --pack . --entrypoints . one two three    # just ".", "./one", "./two", "./three"
attw --pack . --include-entrypoints added      # discovered entrypoints plus "./added"
attw --pack . --exclude-entrypoints styles.css # discovered entrypoints except "./styles.css"
attw --pack . --entrypoints-legacy             # every published code file
```

`--pack` runs `npm pack --ignore-scripts`, so it needs `npm` on `PATH`, and the target's `prepack`/`prepare` scripts do not run. If you use pnpm or yarn, generate the tarball yourself (`pnpm pack` / `yarn pack`) and analyze the file instead:

```shell
pnpm pack && attw *.tgz
```

## Configuration

`attw` reads a JSON config file named `.attw.json` from the current working directory. There is no flag for a different path. Keys are read exactly as written, in camelCase, and the accepted set is closed: `ignoreRules`, `ignoreResolutions`, `format`, `quiet`, `summary`, `emoji`, `color`, `entrypoints`, `includeEntrypoints`, `excludeEntrypoints`, `entrypointsLegacy`, `fromNpm`, `pack`, `registry`. Of these, `ignoreRules` and `registry` supply defaults for their flags today.

```json
{ "ignoreRules": ["no-resolution", "cjs-resolves-to-esm"] }
```

Invalid JSON or an unrecognized key is a failure — exit `1` with a `ConfigInvalid` document on stderr — never a silent skip.

## Migrating from 4.x

Two caller-visible breaks:

1. **A piped invocation that used to receive a table now receives JSON.** The non-TTY default is the envelope. If you need the table on a pipe, pass `-f table` (or `table-flipped` / `ascii`); if you were parsing it, read the envelope instead.
2. **`-f json` no longer prints the old document.** The `{ analysis, problems, summary? }` shape is gone. Map it to the envelope: `analysis.packageName` → `packageName`, `analysis.packageVersion` → `packageVersion`, `analysis.types` → `types`, `analysis.entrypoints` → `entrypoints` (now opt-in via `--include entrypoints`), `problems` stays top-level, and `summary` is replaced by `problemCounts`. An untyped package is `{ "status": "untyped", … }` with no `problems` key, instead of `analysis.types: false` with everything else absent. `attw schema` documents both shapes.

Two supporting changes: failures that used to print to stdout or exit `0` now write a typed document to stderr and exit `1`; and per-problem traces are no longer included unless you pass `--include traces`.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
