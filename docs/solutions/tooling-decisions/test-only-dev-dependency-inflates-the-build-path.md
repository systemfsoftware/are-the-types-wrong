---
title: A test-only workspace devDependency still lands on the build critical path
date: 2026-09-11
category: tooling-decisions
module: arethetypeswrong
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - a package in the workspace is imported only from test files
  - a task declares a build dependency on the upstream package graph
  - a fixture-only edit invalidates consumer builds or typechecks
  - an explicit build wait is being substituted for the upstream package graph
tags: [turbo, task-graph, cache-invalidation, workspace-dependency, type-aware-lint]
---

# A test-only workspace devDependency still lands on the build critical path

## Context

Co-locating a private fixture package with the packages that test against it is
the normal shape for behaviour suites: the fixture synthesizes inputs, the
suites assert on outputs. The fixture is declared as a `devDependency`, which
reads as "test-only, therefore inert for production".

The task runner disagrees. Turbo derives task edges from the **package graph**,
not from the import graph. A `devDependency` produces a package edge of kind
`development`, and a dependency specifier of `^build` walks that edge exactly as
it walks a `production` one. The fixture therefore becomes a transitive
prerequisite of every consumer task whose chain reaches `^build`.

## Failure mechanics

1. `^build` is edge-driven, not import-driven. Nothing inspects which modules a
   consumer actually imports; the edge exists because the manifest declares it.
2. The edge is transitive through the task graph. A consumer whose `build`
   depends on `^build`, and whose `^build` includes the fixture's `build`, waits
   for the fixture before starting — even though its emitted bundle contains no
   reference to it.
3. Cache invalidation follows the same edges, which is where the cost lands. For
   a task set $T$ and a changed package $q$:

$$\text{invalidated}(q) = \{\, t \in T \;\mid\; q \in \text{transitive inputs}(t) \,\}$$

When the edge was declaration-derived rather than data-derived, this set is
strictly larger than the set of tasks that read $q$'s output. The excess is
pure rebuild work, repeated on every edit.
4. The failure is silent. No gate reports a spurious wait; the build graph is
merely serialized and the cache merely misses. A repository with this defect
looks healthy and is slower.

## Architectural Invariants

**I1 — Task edges must approximate data edges, not declaration edges.** A
dependency edge is admissible in a task's `dependsOn` only when the task reads
the dependency's output. A declaration that exists solely for the test lane is
not such a read.

**I2 — Escaping the upstream graph requires an explicit lower bound.** Removing
`^build` must not remove the reads that were real. Replace the upstream graph
with the specific upstream tasks the consumer actually needs, named explicitly:

```
wrong:   build.dependsOn = ["^build"]     # walks every edge, incl. test-only
right:   build.dependsOn = ["<upstream>#build"]   # the one output actually read
absent:  build.dependsOn = []             # admissible only when nothing is read
```

**I3 — An edge is justified by falsification, not by inspection.** Reading
`dependsOn`, or reading the imports, cannot establish whether an edge is needed:
resolution happens through the export map, not the source text. The only sound
test is to remove the upstream artifact and re-run the task. A task that passes
with the artifact absent does not read it.

**I4 — Absence of a runtime import does not imply absence of a resolution
dependency.** This is the boundary that makes I2 dangerous if over-applied. A
type-aware linter resolves the consumer's imports through the upstream package's
export map. With the upstream build artifact absent, the import resolves to
nothing, every use site acquires an error type, and the linter fails with
unsafe-call and unsafe-member-access diagnostics on values the compiler would
otherwise accept. Such a task reads the artifact without ever importing it at
runtime, and it keeps its wait.

The pair to hold together: I2 says cut the graph to the reads; I4 says a read is
defined by resolution, not by `import` statements in the consumer's source.

## Verification

Falsification harness for one candidate edge, per consumer task:

1. Move the upstream build output aside.
2. Run the consumer task.
3. A pass means the edge is declaration-only and can be replaced per I2. A
   failure means the task reads the artifact, and the failure diagnostic names
   the resolution path (a bundler entry-resolution error, or an error-typed
   value surfacing at the use site).
4. Restore the artifact and re-run to confirm the failure was caused by the
   removal and not by the harness.

Measure the effect by counting tasks that miss cache on a single-package edit,
with the task set held constant across both arms. Comparing a filtered count in
one arm against an unfiltered count in the other produces a delta that looks
like an improvement and is an artifact of the filter; the two arms must select
tasks identically.

## When to Apply

- A package is imported only from `tests/` or from test-fixture setup, yet
  appears upstream of a build or typecheck task.
- A single-package edit invalidates tasks in packages that do not import it.
- An explicit upstream task reference is being substituted for `^build`.

## Examples

Symptom: editing a fixture package rebuilds both published packages and the
engine typecheck, though neither imports the fixture outside its tests.

Fix shape: replace the inherited upstream graph on the consumer tasks with an
explicit reference to the one upstream build they read, and leave the upstream
graph intact on `lint`, which resolves the test imports through the export map
and fails per I4 when the artifact is absent. Keep the `devDependency`
declaration — the suite still imports the fixture.

Non-fix: dropping the fixture from `devDependencies` to remove the edge. The
tests break, and the edge returns with the declaration.

## Related

- None yet in this corpus.
