---
title: The nix e2e lane builds only git-tracked files
date: 2026-09-12
category: tooling-decisions
module: arethetypeswrong
problem_type: build_error
component: tooling
severity: high
applies_when:
  - "a locally passing build must also pass through a nix derivation before it counts"
  - "new source modules land alongside a nix-built artifact consumed by a test lane"
symptoms:
  - "`pnpm build` succeeds but the e2e suite fails in beforeAll with UNRESOLVED_IMPORT for a file that exists"
  - "rolldown reports Module not found for a module committed seconds earlier"
root_cause: incomplete_setup
resolution_type: workflow_improvement
related_components:
  - nix
  - "builtins.fetchGit"
  - cleanSourceWith
  - tsdown
  - rolldown
tags: [nix, e2e, git, tracked-files, build, attw, testcontainers]
---

# The nix e2e lane builds only git-tracked files

## Problem

Two units landed new source modules (`RenderMode.ts`, then `Mask.ts`). Local `pnpm build` was green, but every `pnpm test:e2e` run failed inside `beforeAll` with:

```
[UNRESOLVED_IMPORT] Could not resolve './RenderMode.js' in src/AttwExecutor.ts
```

The file existed in the working tree. The nix derivation's copy of the source did not contain it.

## Mechanism

The e2e harness builds the CLI through `nix build .#attw`, and the flake's source snapshot only sees files git tracks (`builtins.fetchGit`/clean-source filtering reads the committed tree, not the working directory). A plain `pnpm build` reads the working directory. So "builds locally" and "builds for the e2e lane" are different claims:

- untracked new files: local build green, nix build red with `Module not found`
- the failure surfaces far from the cause: the vitest `beforeAll` reports a rolldown error from inside a `/nix/store` build of a source snapshot

## Architectural Invariants

**A build claim is scoped to a source snapshot, and different lanes read different snapshots.**
`pnpm build` reads the working directory; a nix flake's `self` (through `builtins.fetchGit` and
clean-source filtering) reads the committed tree. A green local build asserts the working
snapshot, not the snapshot any downstream gate consumes:

```
local build:   working tree          -> passes with untracked files
nix build:     committed tree (git)  -> fails with untracked files in the import graph
CI / e2e:      committed tree (push) -> equal to nix only when the push precedes the run
```

**A gate grades the tree it will read.** Before invoking a lane whose build path runs through
`self`/`fetchGit`, the tree state it requires (clean, or every file in the import graph tracked)
is a precondition of the invocation, not a property of the code.

## Solution

Commit new modules before running the e2e lane. The orchestrator loop becomes: implement unit -> run the unit's focused checks -> `git add <unit files> && git commit` -> then `pnpm test:e2e`. Never run the e2e gate with untracked source files that the binary's import graph reaches.

Verification: after committing, `nix build .#attw` picks up the files and the suite goes green (24/24 on the same tree that failed 13-skipped minutes earlier).

## Prevention

- Treat `pnpm test:e2e` as a committed-tree gate, like CI is: clean tree (or at minimum, all files in the import graph tracked) before invoking it.
- Symptom to grep for: a `Module not found` in a nix build log for a path `ls` confirms exists — that is the working tree and the nix source snapshot diverging.
- The same divergence hits any flake whose source is `self` through fetchGit: containers, VMs, and CI all see the committed tree only.

## Related

- `docs/solutions/tooling-decisions/test-only-dev-dependency-inflates-the-build-path.md` — the same lane's build-critical-path coupling; the e2e task depends on `^build` for the packages its closure builds.
- `docs/solutions/tooling-decisions/bundled-cli-version-comes-from-the-manifest.md` — the nix artifact as the object the e2e assertions actually test.
