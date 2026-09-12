# Proposal: a deterministic lint rule banning snapshot APIs in test files

Owner: the maintainer of the repository's lint surface (the `effect-dmmf` plugin / `oxlint`
configuration). This document is a **proposal and a wait** — the author of this change is not
the owner of the lint surface and must not add or edit a lint rule to grade their own work
(CONST-E9).

## Ask

Add one lint rule that fails a test file which calls a snapshot API:

- `toMatchSnapshot(`, `toMatchInlineSnapshot(`, `toMatchFileSnapshot(`
- `expect(...` containing `.keys(` or `.sort(` used as an equality oracle
- `expect(` containing `readFile(`

## Why the deterministic channel

A reminder-tier TTSR rule (`no-characterization`, `interruptMode: never`) lands this law today,
but it can only inject a reminder in-band. The measured evidence says the deterministic channel
is the one that binds:

- software-wiki canon `linters-direct-agents` — "agents write the code; linters write the law";
  linters are the mechanism that turns conventions into machine-checkable rules inside the
  agent loop.
- software-wiki canon `lint-rules-are-not-instructions` — rule count is the wrong axis; a lint
  diagnostic carries zero standing context cost, while an instruction competes with the task
  every turn.
- arXiv 2604.11088, _Do Agent Rules Shape or Distort? Guardrails Beat Guidance in Coding
  Agents_ — guardrails outperform guidance in coding agents.

A lint rule is free at authoring time, runs on every commit, and cannot be forgotten; a rule
file in `~/.omp` is a reminder that must match a stream position.

## What this does not ask

Not a new CI job, not a threshold, not a bespoke per-directory script — one rule in the existing
lint surface, reusing the mechanism already configured for test-placement and property rules.

## Provenance

Raised while removing this repository's characterization corpus: a 13-file stored-output snapshot
suite (`packages/arethetypeswrong/tests/__fixtures__/snapshots/`), a same-lineage differential
suite against the package's own prior published build, a plugin-manifest text pin, and an exact
key-set equality pin in the e2e lane. All were deleted; the deletion is not enforceable by
deletion alone.
