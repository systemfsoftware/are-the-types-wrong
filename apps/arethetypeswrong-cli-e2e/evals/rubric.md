# attw agent-pattern eval corpus (R10)

A fifth observer over the built CLI. `run.ts` replays `transcripts/*.json` against the binary and scores each
invocation against the contract its transcript encodes. It is not a ship gate and not a coverage gate; the
plan makes this report the required artifact (U10, R10).

Gate for every rule below: `node evals/run.ts` — the transcript named in each section fails the run when its
rule stops holding. Nothing here is `review`-gated.

## Run it

- From `apps/arethetypeswrong-cli-e2e`: `node evals/run.ts`
- From `evals/`: `node run.ts ../../arethetypeswrong-cli/dist/main.mjs`
- From anywhere: `node <path-to>/evals/run.ts [bundle-path]`

`argv[2]` overrides the bundle, resolved against the working directory; the default is
`apps/arethetypeswrong-cli/dist/main.mjs` resolved against this file's directory. Fixture paths inside the
transcripts resolve against `evals/`, never the caller's cwd. Exit code is 0 iff every pattern passes.

Each row prints `PATTERN | RESULT | EXIT | OUT | ERR | DELTA_OUT | DELTA_ERR`. Failures print on stderr:
exit-code mismatch, missing/extra JSON field, missing substring, or unmet emptiness / JSON-ness expectation.

## What decides pass/fail

- **Transcripts decide.** Every envelope key, refusal `kind`, exit code, and stream emptiness is asserted
  directly. `baseline.json` never decides a result — it feeds the delta columns only.
- **Provenance of the baseline.** `baseline.json` (`captured: 2026-09-12`, `dist: ... (pre-flip, HEAD
  24498f8)`) holds the pre-flip byte counts captured in U1, before any output change. A positive
  `DELTA_ERR` on a default analyze is the new stderr hint; a positive `DELTA_OUT` is the new compact
  envelope. Rows recorded pre-flip versus measured now are cited per pattern below.
- A byte number without a baseline certifies nothing, so each transcript names the row it compares against
  (`"baseline"`, or `null`) and the runner fails a transcript whose named row is missing from
  `baseline.json`. Rows with no pre-flip analogue print `n/a`.
- The runner lists unexercised baseline rows after the table, so an exclusion is visible at run time.

## Offline discipline

No invocation touches the network. Fixtures are local, and every refusal fires in `decodePackageSpec` /
`decodeTargetShape` / `decodeIncludeMask` (`apps/arethetypeswrong-cli/src/`) before any fetch. A future
transcript that needs a registry path pins `--registry http://127.0.0.1:9` so the call fails offline and the
refusal stays observable.

## Patterns

Every byte figure below was measured by `node evals/run.ts` on 2026-09-12; the pre-flip figure is the cited
`baseline.json` row.

### minimal-flag-analyze — gate: `transcripts/minimal-flag-analyze.json`

- Call: one positional fixture path, no flags (`fixtures/typed.tgz`, then `fixtures/untyped.tgz`).
- Refusal: none; the assertion is the status discriminator — `status: "ok"` with `problems` and exit 1 for
  the typed fixture, `status: "untyped"`, `types: false`, no `problems`/`problemCounts`, exit 0 for the
  untyped one. Reading typed-ness off the exit code gets the untyped fixture wrong.
- Mask: the default envelope omits `entrypoints`, `buildTools`, `programInfo`; advice arrives only as stderr
  prose (expansion hint; status-discriminator hint).
- Bytes: 351 B out + 117 B err versus `baseline.json:rows[0]` 93 B + 0 B (`+258 / +117`); 92 B + 168 B
  versus `rows[1]` 68 B + 0 B (`+24 / +168`).

### schema-first-discovery — gate: `transcripts/schema-first-discovery.json`

- Call: `attw schema` before choosing flags, then one minimal analyze asserting exactly the keys the
  discovery document named.
- Refusal: none; `schema` exits 0 with empty stderr.
- Mask: the discovered envelope is a two-arm union (`status: "ok"` / `"untyped"`); the analyze step asserts
  the ok arm's required keys present and the masked fields absent.
- Bytes: 15,003 B for the discovery document, no baseline row. The analyze step is the same invocation class
  as `minimal-flag-analyze` and carries its `+258 / +117`.

### traversal-attempt — gate: `transcripts/traversal-attempt.json`

- Call: none; `pkg?fields=name`, `../../etc/passwd`, and `../evil.tgz` must all refuse.
- Refusal: exit 1, empty stdout, typed stderr document — `InvalidPackageSpec` for the field-selection query,
  `TargetNotPackable` for both escapes, each with `message` and `recovery`. The query refuses before any
  I/O; `../../etc/passwd` fails the target-shape decode; `../evil.tgz` passes the shape rule and its read
  fails into the same refusal.
- Mask: the refusal document is the only stderr content; stdout stays empty, so a stdout-only reader sees
  nothing rather than a misleading envelope.
- Bytes: 250 B / 244 B / 244 B stderr, 0 B stdout. No baseline row — pre-flip these reached the network.

### welded-query-string — gate: `transcripts/welded-query-string.json`

- Call: none; URL syntax welded onto a valid spec (`lodash@4.17.21?fields=name`, `lodash@4.17.21#frag`) is
  not a package spec.
- Refusal: exit 1, empty stdout, `InvalidPackageSpec` naming the query or fragment marker and telling the
  caller to drop the URL syntax — the fix instruction, not a registry error.
- Mask: as traversal — failure document on stderr only.
- Bytes: 250 B stderr, 0 B stdout. No baseline row: pre-flip the query reached the registry, so no honest
  pre-flip number exists.

### include-overfetch — gate: `transcripts/include-overfetch.json`

- Call: pass `--include` only when the task needs the field — `--include entrypoints` on
  `fixtures/typed.tgz` returns an envelope carrying `entrypoints` and drops the expansion hint.
- Refusal: an unaccepted field (`--include bogus`) refuses with `InvalidPackageSpec` ("The --include flag
  names a field this tool does not accept."), exit 1, empty stdout — never silently ignored.
- Mask: the requested field appears, `buildTools`/`programInfo` stay absent, and stderr is empty because the
  expansion hint no longer applies.
- Bytes: 18,335 B versus the 351 B default — about 52× the envelope for one field (17,984 B of overfetch).
  The corpus prices the overfetch rather than forbidding it. No baseline row: the flag did not exist.

### quiet-on-pipe — gate: `transcripts/quiet-on-pipe.json`

- Call: `--quiet` as gate mode — `--quiet fixtures/typed.tgz`, `--quiet fixtures/untyped.tgz`.
- Refusal: none; both are ordinary analyses with suppressed output.
- Mask: strictest — stdout and stderr both empty, so the exit code is the whole observable (1 for a visible
  problem, 0 for untyped). Hints are suppressed too, which is what makes it pipeline-safe.
- Bytes: 0 B + 0 B, unchanged from `baseline.json:rows[4]` 0 B + 0 B. The untyped form has no baseline row.

### tty-table-parse — gate: `transcripts/tty-table-parse.json`

- Call: none. The rule is a prohibition — `-f table` through a pipe is human output, so never parse it; the
  machine contract is the default envelope.
- Refusal: none; the command exits 1 because the fixture has a visible problem.
- Mask: stdout is asserted **not** to be JSON while still carrying the table markers (`NamedExports: 1`,
  `Entrypoint`), and stderr is empty — human render mode emits no hints. This catches an agent scraping a
  table.
- Bytes: 127 B + 0 B, delta `0 / 0` against `baseline.json:rows[2]` 127 B + 0 B. Explicit format is
  preserved byte-for-byte, so a piped table consumer migrating per R11 can rely on the bytes not moving.

## Rows without a transcript

- `--profile node16 fixtures/typed-node10.tgz` (`baseline.json:rows[3]`, 93 B + 0 B): profile selection is a
  resolution-policy call, not one of the seven agent patterns. The runner lists it as unexercised.
- `-f json fixtures/typed.tgz` (`baseline.json:rows[5]`, 25,001 B + 0 B): **the invocation class changed**.
  Post-flip `-f json` emits the same compact envelope as the default (351 B + 117 B measured), so keeping it
  as a pattern would double-count `minimal-flag-analyze`. Its 24,650 B stdout saving is recorded here, not
  scored.
- `--pack fixtures/pack-dir` (`baseline.json:rows[6]`, 93 B + 0 B): `--pack` is the write-adjacent exception
  (R9) — it creates and deletes a tarball — so it sits outside the read-shaped corpus. The fixture directory
  stays for that future row.

## Not collected by a test runner or a mutator

- `apps/arethetypeswrong-cli-e2e/vitest.config.ts` sets `include: ['tests/**/*.test.ts']` and
  `passWithNoTests: false`, so nothing under `evals/` is collected. Observed: `pnpm exec vitest list
  --filesOnly` in that package lists only `tests/cli.e2e.test.ts`.
- `evals/` holds no `*.test.ts`; `run.ts` imports only `node:` builtins and never imports vitest, so no
  include glob or mutation config reaches it by convention.
- `apps/arethetypeswrong-cli-e2e/package.json` declares no `test` script, only `test:e2e` (`vitest run`), so
  the root `test` turbo task never enters the package; the root `test:e2e` task is `cache: false` with no
  inputs (`turbo.json`).
- No workspace package declares a `mutation` script — only the root `package.json` delegates to the turbo
  task — and no stryker config is tracked (`git ls-files` matches only
  `docs/solutions/tooling-decisions/stryker-nan-mutation-score-scaffold-packages.md`), so the root `mutation`
  task has no subject here. If a stryker config lands for the e2e package, its `mutate` glob decides what it
  sees, and `evals/run.ts` sits outside the `tests/**` tree.

## Determinism and failure modes

- Deterministic: sorted transcript listing, `process.execPath`, cwd pinned to `evals/`, 60 s per invocation,
  no network, no clock, no environment input, no cross-invocation ordering.
- Loud failure, never a silent pass: missing bundle (`binary not found:`), empty transcripts directory,
  malformed transcript (missing `argv`/`expect`, wrong field types), a named baseline row absent from
  `baseline.json`, or an empty `invocations[]` all abort with a nonzero exit.
- Verified by `node evals/run.ts`: 7/7 patterns and 14/14 invocations pass (exit 0); `/bin/true` as the
  bundle gives 0/14 with a reason per invocation (exit 1); a wrong bundle path exits 1 at the preflight.
  `baseline.json` needed no correction.
