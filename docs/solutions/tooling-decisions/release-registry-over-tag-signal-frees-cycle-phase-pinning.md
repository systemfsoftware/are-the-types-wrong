---
title: Use the registry as the released-cycle signal; the tag is downstream of it
date: 2026-09-11
category: tooling-decisions
module: arethetypeswrong
problem_type: workflow_issue
component: tooling
severity: high
symptoms:
  - "the Release assert step fails with: Missing changelog for <name>@<version> — expected .changeset/changelogs/<scope>!<name>@<version>.md"
  - "the version · open release PR job is skipped on every push to main"
  - "origin ends up with zero tags for a workspace whose package versions are already on npm"
  - "the cycle phase is pinned to publish forever, so pending changeset intents are never consumed"
root_cause: missing_workflow_step
resolution_type: code_fix
related_components:
  - scripts/lib/cycle.ts
  - scripts/plan-release.ts
  - scripts/tag-released-packages.ts
  - scripts/create-github-releases.ts
  - .github/workflows/release.yml
tags: [release, github-actions, registry-signal, changeset, cycle-pinning, deno-permissions]
---

# Use the registry as the released-cycle signal; the tag is downstream of it

## Problem

`loadWorkspaceCycle` decided "released this cycle" from _the absence of a git
tag_, so the set of pending releases could only be emptied by a tag that the
workflow writes after the step the pending set was failing. `origin` had zero
tags, and the two public packages were already served by npm at their manifest
versions (npm registry, not repo paths), so the set stayed permanently
non-empty.

Boundary: the defect is reachable on any push to `main`, in CI only, and it is
self-locking — the failing gate is the same gate that would have made the signal
true. It is not reproducible from a clean local checkout, because the observed
state depends on remote tag absence.

## Symptoms

- The publish job fails at its assert step with
  `Missing changelog for @systemfsoftware/arethetypeswrong@7.0.0: expected
  .changeset/changelogs/@systemfsoftware!arethetypeswrong@7.0.0.md`, for a
  version npm already serves.
- The `version · open release PR` job reports **skipped** on every run, because
  `plan-release` prints `this_cycle=2 -> phase=publish` and that job is gated on
  `phase == 'version'`.
- `git ls-remote --tags origin` returns nothing.

## What Didn't Work

1. **Reading a git tag as evidence of release.** The tag is written _after_ the
   gate the missing tag was failing, so the predicate could never become true.
   Any detector anchored on a downstream artifact inherits this circularity.
2. **Treating the empty tag list as the anomaly.** Nothing was broken about it:
   no tag was ever meant to exist until a publish succeeded, and none had.
3. **Collapsing every non-2xx into "unpublished".** This moved the deadlock
   behind an HTTP error — a 429 or 5xx reclassified an already-published package
   as in-cycle and re-pinned the phase.
4. (session history) Rebase-after-squash is established _branch_ hygiene here
   (PR #7 was rebased onto `origin/main` after its base merged). Applied to
   `main` itself it silently discarded this fix once.

## Solution

```ts
export const isPublished = async (name: string, version: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${name}@${version}`)
  return true
}

export const loadWorkspaceCycle = async (): Promise<CycleEntry[]> => {
  const pkgs = await publicPackages()
  const published = await Promise.all(pkgs.map(({ name, version }) => isPublished(name, version)))
  return pkgs
    .filter((_, i) => !published[i])
    .map(({ name, version }) => ({
      name,
      version,
      tag: `${name}@v${version}`,
      changelog: join('.changeset', 'changelogs', `${name.replace('/', '!')}@${version}.md`),
    }))
}
```

`publicPackages` keeps only manifests that declare a name and version and are not
private. `unpublishedOf` routes through the same `isPublished`, so the boolean
and the error envelope cannot drift between call sites.

`plan-release` also needs `registry.npmjs.org` in its `--allow-net`: it reaches
`fetch` transitively through this module, and Deno throws `NotCapable` without
the grant — the phase step cannot run at all. `tag-released-packages` and
`create-github-releases` already carried it, because both already queried the
registry before this change.

## Architectural Invariant

**Authoritative Truth Source, With a Three-State Probe.** The predicate that
answers "has this manifest version shipped?" must read the authority that owns
the fact, and must not fold its inability to read it into an answer.

$$\text{isPublished}(n, v) = \begin{cases}
\text{true} & \texttt{GET registry/<n>/<v>} \to 200 \\
\text{false} & \texttt{GET registry/<n>/<v>} \to 404 \\
\text{throw} & \text{otherwise — 429, 5xx, network}
\end{cases}$$

Release status is owned by the registry, not by git: the tag is a _consequence_
of a successful publish, so it can never be the evidence that the publish should
happen. The registry has no such circularity — a version either is served or is
not, independent of whether this pipeline succeeded.

The three-state split is the second half. A two-state probe must answer _no_
when it means _I could not tell_, and that is exactly how a published package
re-enters the cycle. `404` is the registry's only "no"; every other outcome is
"cannot tell", and cannot-tell must abort the run rather than feed the phase
machine a false negative.

The changelog requirement follows from the same split. `pnpm version -r` bumps
each manifest it is consuming an intent for and writes one changelog per bumped
version — observed directly in a scratch clone: given intents for both packages,
it emitted exactly one file per bumped version and none for versions it left
alone. A version already at its manifest value is never bumped, so no changelog
for it can exist, and a detector that lists it as pending has created an
unsatisfiable requirement.

**Anti-pattern (grep-able):** a release predicate that returns a boolean from a
response whose non-2xx branch is a single `return false` —

```
if (!res.ok) return false     // ← conflates 404 with 429/5xx
```

The compliant shape branches on the status it can interpret and throws on the
rest. This repo already used that shape in `AttwExecutor` against the same
registry, so the fix follows existing convention rather than inventing one.

## Prevention

- **Never let a release detector read a downstream artifact.** Tags, GitHub
  Releases, and changelog files are written after the gate that consumes them.
  Detect from the authority; treat the rest as outputs.
- **Never fold an error envelope into an answer.** Throw on non-404 so a
  registry incident fails the run instead of reclassifying.
- **Grant `--allow-net` to every Deno entrypoint that reaches the registry**,
  including one-shot scripts: `plan-release` looks harmless but calls
  `loadWorkspaceCycle`, and without the grant the phase step cannot run at all.
  A script that already queries the registry keeps its grant; a script that
  _newly_ gains a transitive registry call needs one added.
- **Confirm a fix is on `origin/main` before claiming it shipped.** A merged PR
  is not proof — this fix was squash-merged, then orphaned when `main` was reset
  and rebased onto an earlier commit, leaving the PR reading MERGED while the
  tree lost the change. Use `git log origin/main`.
- **Test the three-way split, not the truth table.** Stub `fetch` for 200, 404,
  429, 500, 503: `true`, `false`, then throw. Covering only 200 and 404 leaves
  the transient path silently reclassifying.
- **Beware `pnpm version -r` deleting a `none` intent.** When another intent
  releases a package, `pnpm version -r` garbage-collects a sibling intent that
  declared that package `none` — reproducible in a scratch clone: running it
  once removed a `none`-for-all-packages intent while leaving the consuming
  intents in place. `.changeset/README.md` states intent files are retained, so
  the recorded contract and the observed behavior disagree. Treat a `none` file
  as at risk if a later intent releases one of the packages it names.

## Related Issues

- PR #15 — attempted this fix; squash-merged, then orphaned by a `main` reset
  and rebase. The working fix is on branch `fix/release-cycle-registry-v2`.
- `docs/solutions/tooling-decisions/registry-consumption-severs-relocation-build-cycles.md`
  — the sister invariant: the registry is also the authority that breaks build
  cycles, there to keep the task graph acyclic rather than to detect releases.
- `AGENTS.md` — the boundary table keeps `.github/workflows/**` read-only, which
  is why this fix lives in the `scripts/` that drive the workflow.
