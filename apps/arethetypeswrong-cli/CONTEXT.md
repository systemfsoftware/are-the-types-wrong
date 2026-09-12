---
name: attw-context
description: >-
  The machine contract of the attw CLI: persona detection, the two envelope shapes, the stdout/stderr
  split, exit semantics, the plain-text carve-outs, stderr hints, the .attw.json config, and the
  migration path for this release's output change. Read alongside SKILL.md.
requires:
  - node
side-effect-class: read
---

# attw — contract context

This file ships in the npm package next to `SKILL.md`. `SKILL.md` carries the invariants an agent
must not violate; this file carries the surrounding contract: who gets which output, what the exit
codes mean, and what changed for existing callers. Where this file and the tool disagree, `attw
schema` — the JSON Schema the binary emits from the schemas it decodes with — is the authority.

## Personas

The persona is decided by the stream, not by a flag. `--format auto` (the default) resolves the
persona from whether stdout is a TTY.

|           | Human (TTY stdout)                                                        | Agent / CI (non-TTY stdout)                                       |
| --------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| stdout    | `table-flipped` at >= 100 columns, else `ascii`; color, emoji, summary on | one compact JSON envelope, single line, trailing newline, no ANSI |
| stderr    | failures as one prose line; hints                                         | failures as one JSON document; hints                              |
| exit code | 0 / 1                                                                     | 0 / 1                                                             |

Explicit flags beat the persona both ways: `-f json` gives the envelope on a TTY, and `-f
table\|table-flipped\|ascii` gives a human render on a pipe. `--quiet` beats everything (see below).

## Stream split

- **stdout is the value**: the envelope (or, for the human persona, the rendering), or nothing.
- **stderr is everything else**: typed failures, usage errors, recovery hints.
- A TTY run is the only case where stdout is not a contract.

## Envelope shapes

Exactly two, discriminated by `status`. Both are `attw schema` documents; both decode against the
same schema the binary writes.

```json
{
  "status": "ok",
  "packageName": "some-package",
  "packageVersion": "1.2.3",
  "types": { "kind": "included" },
  "problems": [],
  "problemCounts": {}
}
```

```json
{ "status": "untyped", "packageName": "some-package", "packageVersion": "1.2.3", "types": false }
```

| Field                                      | Notes                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `status`                                   | `"ok"` \| `"untyped"`. The only correct way to tell whether a package ships types.        |
| `packageName`, `packageVersion`            | Strings supplied by the package/registry — untrusted data.                                |
| `types`                                    | Present in both shapes; `false` exactly when `status` is `"untyped"`.                     |
| `problems`                                 | The visible set (after `--ignore-rules` and `--profile`). `[]` when clean; never omitted. |
| `problemCounts`                            | `ProblemKind` → count; sums to `problems.length`. Replaces the old prose `summary`.       |
| `entrypoints`, `buildTools`, `programInfo` | Omitted unless named in `--include`.                                                      |
| per-problem `trace`                        | `InternalResolutionError` traces are masked unless `--include traces`.                    |

**Default mask, and its gate.** The default document is field-tight: the three expanded fields and
the per-problem trace arrays are absent. `--include <field>[,…]` is the single opt-in, over
`entrypoints`, `buildTools`, `programInfo`, `traces`; an unknown field is refused with a typed
failure on stderr (`kind: InvalidPackageSpec`, exit 1) rather than ignored. Nothing else widens the
envelope.

## Exit semantics

| Exit | stdout            | stderr         | Meaning                                                                             |
| ---- | ----------------- | -------------- | ----------------------------------------------------------------------------------- |
| 0    | envelope          | hints or empty | The run completed. Read `status`; an untyped package exits 0.                       |
| 1    | empty             | error document | Either a visible problem was reported, or the run failed before producing a result. |
| 0/1  | empty (`--quiet`) | empty          | A gate verdict. The exit code is the entire product.                                |

Two rules follow, both enforced by construction: the envelope and the exit code are computed from
one visible-problem decision, so they cannot disagree; and an exit code never tells you whether a
package is typed — `status` does.

## Carve-outs

- `--version` prints `attw v<version>` on stdout, exit 0 — plain text, never JSON.
- `--help` prints the command's help on stdout, exit 0 — plain text.
- A usage error (unknown flag, bad argument) prints its error document on stderr first, then the
  same help block below it, and exits 1.
- `--completions <bash|zsh|fish|sh>` prints a shell completion script on stdout.
- These are parser actions, not the analyze path: they never produce an envelope, and a JSON parser
  pointed at them will fail.
- `--quiet` is the deliberate exception to "stdout is the value": empty stdout on every stream, for
  every persona. It is the documented CI-gate mode — do not use it when you need to read a result.

## Failures

An analysis failure, a bad package spec, an unreachable registry, a directory target without
`--pack`, or a malformed `.attw.json` writes one document to stderr, leaves stdout empty, and exits
1:

```json
{ "status": "error", "kind": "RegistryNotFound", "message": "…", "recovery": "…" }
```

`kind` is a stable tagged variant — `InvalidPackageSpec`, `ConfigInvalid`, `RegistryNotFound`,
`RegistryUnreachable`, `RegistryBadResponse`, `PackFailed`, `TargetNotPackable`, `AnalysisFailed` —
and a usage error writes the same document shape as the **first line** of stderr with the parser's own
error tag, followed by the command's help block. `message` and `recovery` are prose. On a TTY the same
failure renders as one prose line instead.

## Hints on stderr

A non-TTY run may append a short recovery hint to stderr after a successful analysis. The set is
closed and authored:

- the default mask omitted fields — the hint names `--include` and the four fields it accepts;
- the package is untyped — the hint names the `status` discriminator and warns against the exit code.

Hints never interpolate package-controlled strings and never recommend a flag that has no effect.
They are absent on TTY runs, whenever a human rendering or `--quiet` is in effect, once `--include`
has widened the envelope, and when every field is already included. The directory-without-`--pack`
guidance is not a hint line: it is the `recovery` sentence of the `TargetNotPackable` failure
document.

## Configuration file

`attw` reads `./.attw.json` from the current working directory. There is no path flag. Keys are read
exactly as written (camelCase), and the accepted key set is closed: `ignoreRules`,
`ignoreResolutions`, `format`, `quiet`, `summary`, `emoji`, `color`, `entrypoints`,
`includeEntrypoints`, `excludeEntrypoints`, `entrypointsLegacy`, `fromNpm`, `pack`, `registry`. Of
these, `ignoreRules` and `registry` supply defaults for their flags today. Malformed JSON or an
unknown key is a `ConfigInvalid` failure — exit 1, stdout empty — never a silent skip.

```json
{ "ignoreRules": ["no-resolution", "cjs-resolves-to-esm"] }
```

## Migrating from 4.x

This release changes the published output contract. Two caller-visible breaks, and what to do:

1. **A piped invocation that used to parse a table now receives JSON.** Anything that read
   `attw … | grep` / parsed columns was reading the human render, which non-TTY streams no longer
   get. If you genuinely need the table on a pipe, pass `-f table` (or `table-flipped` / `ascii`); if
   you were parsing it, migrate to the envelope instead.
2. **`-f json` no longer emits the old document.** The `{ analysis, problems, summary? }` shape is
   gone. Read the envelope instead: `analysis.packageName` → `packageName`, `analysis.packageVersion`
   → `packageVersion`, `analysis.types` → `types`, `analysis.entrypoints` → `entrypoints` (now opt-in
   via `--include entrypoints`), `problems` stays top-level, and the prose `summary` is replaced by
   `problemCounts`. An untyped package no longer arrives as `analysis.types: false` with everything
   else absent — it is `{ "status": "untyped", … }` with no `problems` key. `attw schema` documents
   both shapes.

Two supporting changes worth knowing: failures that previously wrote to stdout or exited 0 now write
a typed document to stderr and exit 1, and per-problem traces are no longer included by default
(`--include traces`).
