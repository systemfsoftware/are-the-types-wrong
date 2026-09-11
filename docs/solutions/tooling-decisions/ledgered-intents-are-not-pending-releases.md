---
title: Ledgered leftover intents are not a pending release
date: 2026-09-11
category: tooling-decisions
module: arethetypeswrong
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "GitHub Actions opens chore(release): version packages PRs that only delete leftover .changeset files"
  - "the PR three-dot-diffs files that no longer exist on main"
  - "plan-release prints pending_intents>0 this_cycle=0 -> phase=version after a published cycle"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - scripts/plan-release.ts
  - scripts/lib/pending-intents.ts
  - scripts/open-release-pr.sh
tags: [release, changeset, ledger, phantom-pr, github-actions]
---

# Ledgered leftover intents are not a pending release

## Problem

After a real version PR publishes, leftover `.changeset/*.md` intent files (retained per README, recorded in `ledger.yaml`) retrigger `phase=version`. The version job then opens a PR that only deletes those files and the authored changelogs. A queued run on a stale SHA reopens the same empty tree as a new PR.

## Symptoms

- `plan-release: pending_intents=3 this_cycle=0 -> phase=version` on a tree whose intents are already in `ledger.yaml`
- Version job logs `No pending changes. Record one with "pnpm change"` then still commits deletions
- GitHub three-dot diff lists files already absent from `main`; two-dot vs `main` is empty

## What Didn't Work

- Closing the phantom PR. The next `push` to `main` with leftover files, or a queued Release run (`cancel-in-progress: false`), opened another
- Merging the deletion PR (#21). That removed the files from `main` but a stale job checked out the parent SHA and recreated `changeset-release/main`

## Solution

Count pending intents as `.changeset/*.md` files whose stem is **not** listed in `ledger.yaml`. Parse the ledger as YAML so quoted stems and `intents:` arrays match the on-disk filenames.

Refuse to open a version PR unless `apps/**/package.json` or `packages/**/package.json` actually differs from `origin/$BASE`.

## Why This Works

`.changeset/README.md` already states a present intent file never implies a pending release. `plan-release` was counting files, not unconsumed files. After a published cycle (`this_cycle=0`), leftover files must yield `phase=none`. The package.json guard stops a stale SHA from republishing an already-squash-merged tree even if plan-release regresses.

## Prevention

- Gate `phase=version` on unconsumed intents, not on glob presence
- Gate the Release PR on a real version bump against latest `main`, not on a dirty working tree
- Keep a Deno test that a ledgered leftover file is not pending

## Related Issues

- Related: #22 (closed phantom PR)
- Related: #21 (merged deletion-only version PR)
- `docs/solutions/tooling-decisions/release-registry-over-tag-signal-frees-cycle-phase-pinning.md` — the sister signal that made `this_cycle=0` possible and unmasked this counter
