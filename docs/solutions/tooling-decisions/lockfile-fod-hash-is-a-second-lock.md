---
title: A fetchPnpmDeps store hash is a second lock Dependabot cannot update
date: 2026-09-11
category: tooling-decisions
module: attw-nix
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - a flake package uses fetchPnpmDeps with a committed hash
  - an npm-native updater rewrites pnpm-lock.yaml
  - CI builds the flake package from that lockfile
tags: [nix, pnpm, fetchpnpndeps, dependabot, lockfile]
---

# A fetchPnpmDeps store hash is a second lock Dependabot cannot update

## Problem

`pnpm-lock.yaml` already pins every registry tarball. `fetchPnpmDeps` hashes the
realized store as a second pin. An npm-native updater rewrites the first lock
and never the second. The e2e lane is the only CI job that runs
`nix build .#attw`, so the mismatch is invisible to `check`.

## Failure mechanics

1. Two locks, one updater. Let $L$ be the lockfile and $H = \mathrm{hash}(\mathrm{store}(L))$.
   Dependabot writes $L' \neq L$. CI still asserts $H$. Nix computes
   $H' = \mathrm{hash}(\mathrm{store}(L'))$ and fails closed:
   `hash mismatch in fixed-output derivation` on `*-pnpm-deps.drv`.
2. The store hash is not portable across nixpkgs. A consumer with
   `inputs.nixpkgs.follows` rebuilds the FOD with a different sqlite dump
   format and $H$ is wrong again even when $L$ did not change.
3. Pasting `got:` into the derivation is a third lock of the same data. The
   next $L''$ fails the same way.

## Architectural Invariants

**I1 — One pin per package, from the lockfile.** Each `packages[].resolution.integrity`
is the fetch hash. A store-wide FOD of $\mathrm{store}(L)$ is not an extra
integrity; it is a second lock of $L$.

```
wrong:  pnpmDeps = fetchPnpmDeps { hash = "<store of L>"; }
right:  mitmCache = importPnpmLock { lockFile = <L>; }
```

**I2 — The actor that mutates $L$ must be able to mutate every pin of $L$.**
`nix-update-script` updates $H$ with $L$. Dependabot does not. If the updater
cannot write $H$, $H$ must not exist.

**I3 — A skipped test suite is not a green build.** A FOD mismatch aborts
`nix build` in globalSetup; the e2e file fails with tests skipped. That is a
loud miss of the published CLI, not a test defect.

## Verification

Gate: `nix build .#attw`. A lockfile-only bump must succeed without editing
the derivation. A committed `fetchPnpmDeps.hash` that does not match
$\mathrm{store}(L)$ fails that command.

Smell: `fetchPnpmDeps` plus a literal `hash = "sha256-..."` next to a
Dependabot (or Renovate npm) lockfile workflow.

## Related

- Related: #13
- docs/solutions/tooling-decisions/test-only-dev-dependency-inflates-the-build-path.md
