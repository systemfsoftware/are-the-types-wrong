---
title: Registry consumption severs relocation build cycles for co-located fork packages
date: 2026-09-11
category: tooling-decisions
module: arethetypeswrong
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - relocating a self-hosted fork package out of a monorepo into a standalone workspace
  - adding a devDependency from a relocated package onto one of its own build inputs
  - a task runner reports a cyclic workspace dependency or a build-ordering SCC
tags: [relocation, registry-consumption, build-ordering, cyclic-workspace, arethetypeswrong]
---

# Registry consumption severs relocation build cycles for co-located fork packages

## Context

Relocating the arethetypeswrong fork out of the systemfsoftware monorepo
co-locates core, cli, and recipes in one workspace for the first time. The
dependency shape inverts: in the monorepo, cli built **from** core and core
merely typechecked against the published cli, so a one-way workspace edge was
safe. Co-located, core's test lane executes the cli binary while cli's build
lane compiles against core's output. Porting core's cli devDependency as a
workspace link closes that loop, and the task graph becomes unbuildable.

## Failure mechanics

1. Workspace-linked devDependency creates task edges, not just install edges:
   `test(core) → build(cli) → build(core)`. Together with cli's runtime edge
   `build(cli) → build(core)`, core and cli form a strongly-connected build
   component of size 2. No topological order exists; every ordering violates
   one edge.
2. The failure is loud at both layers. pnpm prints a cyclic-workspace warning
   naming the pair during install; turbo refuses to schedule the cycle during
   build. Neither gate is silent, but both fire only after the wrong edge is
   written — the gates detect, they do not prevent.
3. Only the `workspace:` protocol produces these edges. A plain semver range —
   even through a catalog — resolves from the registry, materializes a
   published artifact, and never enters the build DAG. This is the same
   mechanism the monorepo relied on when 36 consumers registry-consumed the
   cli through `catalog:attw`.

## Architectural invariant

**Build-graph acyclicity:** a workspace-linked edge `p → q` is admissible iff
no build-or-test-ordering path leads back from `q` to `p`. Formally, the task
graph restricted to workspace-linked edges must stay a DAG:

$$\text{acyclic}(G) \iff \forall\, p \xrightarrow{\text{ws}} q:\; q \not\to^{*} p$$

When two packages genuinely need each other's artifacts, the back edge must
consume the published artifact instead. Applied here: cli keeps
`workspace:*` onto core (one-way, build-ordered); core devDependencies the cli
as the registry range `^4.0.0`. Recipes similarly registry-consume
`@systemfsoftware/npm-package`. The registry edge trades freshness for
orderability — the cli's changes reach core's test lane only at the next
publish, which is the accepted relocation trade.

## Verification

- `pnpm install` exits 0 with no "cyclic workspace dependencies" warning.
- `pnpm build` (turbo) schedules all packages with no cycle failure.
- `pnpm test` passes with core's suites exercising the published cli.

## When to Apply

- A relocation places a consumer and its build input in one workspace.
- A devDependency direction inverts relative to the source repo's layout.
- A task runner reports an SCC over workspace `link:` edges.

## Examples

Symptom: after moving packages, install warns "cyclic workspace dependencies"
naming the core/cli pair, or turbo aborts build with an ordering cycle.

Fix shape: keep the build-ordered edge workspace-linked; flip the inverted
devDependency to a published version range so the registry, not the workspace,
satisfies it.

## Related

- systemfsoftware/systemfsoftware `docs/solutions/tooling-decisions/registry-consumption-of-self-hosted-forks.md` — extends that invariant to the cross-repo relocation case: when co-location inverts a dependency direction, the consumption side inverts with it.
- systemfsoftware/systemfsoftware `docs/solutions/tooling-decisions/arethetypeswrong-core-requires-js-typescript-api.md` — the `typescript@^6.0.3` JS-bridge pin travels with core; 7.x has no JS compiler API and breaks the analysis engine.
