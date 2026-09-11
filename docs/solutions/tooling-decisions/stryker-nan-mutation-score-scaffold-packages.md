---
title: Mutation Score NaN on Scaffold Packages with Zero Planned Mutants
date: "2026-09-11"
category: tooling-decisions
module: stryker-mutation-testing
problem_type: tooling_decision
component: tooling
severity: low
symptoms:
  - Stryker exits with score NaN when no mutants are planned or hit
  - Unused template scaffold packages cause false-positive build overhead and reporting anomalies
tags:
  - stryker
  - mutation-testing
  - monorepo-scaffolding
---

## Problem

When a workspace package contains trivial or unexercised code without mutating branches, Stryker calculates a mutation score of `NaN`.

$$\text{Score} = \frac{\text{Killed}}{\text{Killed} + \text{Survived} + \text{TimedOut}} \times 100$$

When the denominator evaluates to zero ($0 / 0$), JavaScript evaluates the score as `NaN`. While Stryker treats `NaN >= 100` as passing the break threshold, downstream tooling and CI dashboards report confusing metrics or fail strict numerical parsing. Furthermore, retaining residual template scaffold packages in an extracted monorepo incurs unnecessary task orchestration overhead during CI verification gates.

## Architectural Invariants

### 1. Zero-Mutant Package Elimination

A package must not be enrolled in workspace-wide mutation testing unless it contains substantive logic and an accompanying test suite capable of killing mutants.

- Pure declaration packages or scaffold packages must either omit the mutation task from `turbo.json` or be purged from the workspace.
- Extracted repositories must remove starter scaffold workspaces during migration before enabling CI mutation enforcement.

### 2. Workspace Domain Purity

Every active package in a monorepo workspace must correspond to an actual published artifact or an active test fixture. Inactive scaffold directories pollute dependency graphs, lockfiles, and release workflows.

## Verification

Run workspace-wide CI checks to verify that every active package has a valid, non-`NaN` task execution:

```bash
pnpm check:ci
```
