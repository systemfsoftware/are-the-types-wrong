---
title: Self-name imports under type-aware lint need the source condition and a prior build
date: 2026-09-10
category: tooling-decisions
module: starter template toolchain
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - behaviour tests import the package under test by its published self-name
  - a type-aware lint gate resolves imports independently of the test runner
tags: [self-import, source-condition, type-aware-lint, build-ordering]
---

# Self-name imports under type-aware lint need the source condition and a prior build

## Context

Behaviour tests must import the package surface by its published self-name,
never by a relative reach into internals. Two consumers resolve that
specifier differently: the test runner through an alias to source, the
type-aware lint checker through the type system. When the two disagree, the
checker types the import as an error and flags every use site as an unsafe
call of an untyped value, while the compiler and the test run stay green.

## Guidance

Publish a source-condition entry in the package export map alongside the
default built entry, enable that condition in the compiler options, and order
the task graph so the type-aware gate runs only after the build task
produces the default entry.

```json
{
  ".": {
    "@systemfsoftware/source": "./src/index.ts",
    "default": "./dist/index.js"
  }
}
```

The runner alias keeps execution on source; the export map keeps every other
resolver honest. Neither alone covers both consumers.

## Why This Matters

Resolution-consistency invariant: every gate that types an import must
resolve it through the same condition set the compiler uses, and every
specifier whose default target is a build artifact makes its gates depend on
the build. Violate the first half and the checker invents an error type the
compiler never sees. Violate the second half and a clean checkout fails a
gate that passes on a stale tree.

## When to Apply

- A behaviour suite imports the system under test by package self-name.
- A type-aware check reports unsafe-call or error-type diagnostics on an
  import the compiler accepts.

## Examples

Symptom: the checker reports an unsafe call of an error-typed value at the
call site of a self-imported symbol, while the typecheck task and the test
task both pass.

Fix shape: add the source-condition export entry plus the matching compiler
condition, then declare the build as a prerequisite of the test and lint
tasks so the default entry exists before either resolves it.

## Related

- None yet in this corpus.
