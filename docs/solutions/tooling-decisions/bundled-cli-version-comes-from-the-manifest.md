---
title: A bundled CLI derives its printed version from the manifest
date: 2026-09-11
category: tooling-decisions
module: arethetypeswrong
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "adding or reviving a version flag, banner, or User-Agent on a bundled executable"
  - "choosing a tsconfig preset for a package a bundler resolves"
symptoms:
  - "attw --version printed 1.1.1 while the CLI manifest was at 4.1.0"
  - "the printed version matched no release and no test noticed"
root_cause: config_error
resolution_type: code_fix
related_components:
  - Command.runWith
  - tsdown
  - "@systemfsoftware/tsconfig/bundler/no-dom"
  - manifestVersion
tags: [cli, version, tsdown, rolldown, tsconfig-preset, bundler, regression-test, attw]
---

# A bundled CLI derives its printed version from the manifest

## Problem

`attw --version` answered `1.1.1` while the CLI's own manifest said 4.1.0. The value came from a literal passed to `Command.runWith(attwCommand, { version })`, so the flag kept working, printed something plausible, and could not be tied to any release. Nothing downstream noticed: the e2e lane invoked `--version` and asserted only exit code 0.

## Mechanism

1. **A literal is a second source of truth.** The manifest already owns the version; a literal next to it drifts silently, because nothing fails when the two disagree. The failure is invisible to the compiler and to any test asserting only that the flag runs.
2. **The artifact ships without its inputs.** The published package lists only `dist` and `LICENSE` in `files`, and the nix derivation installs the bundled entry alone into the store, wrapping it with a pinned Node. A runtime read of the manifest would find no file in either install path, so the value must be a build-time constant.
3. **The compiler config named the wrong resolver.** The package extended the NodeNext library preset every other workspace package extends, but nothing resolves its imports through Node: tsdown inlines every non-`node:` import into one ESM file. A preset that models Node's resolver describes a resolver that never runs, and it demands an import attribute for the JSON import that the bundler does not need.

## Architectural Invariants

**A released value has exactly one owner.** A version, banner, or identifier a user can read derives from the manifest the release pipeline bumps; the artifact carries the value baked, never a hand-copied duplicate.

**A build-time constant replaces a runtime fetch when the artifact ships without its inputs.** Substituting the manifest into the bundle is what makes the single-file install paths work:

```
before: writeVersion('1.1.1')                     // second source of truth, drifts silently
after:  writeVersion(manifest.version)            // inlined by the bundler at build time
```

**The resolver model in the compiler config must name the resolver that actually runs.** `tsc/*` presets describe a package Node resolves; `bundler/*` presets describe a package a bundler inlines. Choosing by repo precedent rather than by the consumer is how a package ends up typechecked against a resolver it never uses.

**Derivation is only correct if the build runs after the bump.** Ordering is the load-bearing part of the invariant, not the import: the release `version` job bumps manifests and commits, the `publish` job builds before publishing, and the package's own `prepack` rebuilds while packing. A manual publish against a stale `dist` is the remaining window, and `prepack` is what closes it.

**A regression test for a baked value asserts against the file the build read.** Asserting one baked copy against another passes in exactly the case that matters — when both drifted. The e2e lane reads the CLI manifest and compares the binary's output to it.

## Verification and Prevention

The e2e lane carries the assertion, because that lane already runs the published binary. `manifestVersion(url)` decodes the manifest rather than casting it, so a manifest without a string version throws instead of making both comparison sides `undefined`:

```ts
const decode = (raw: string): string => {
  const manifest: unknown = JSON.parse(raw)
  if (
    typeof manifest !== 'object' || manifest === null || !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) throw new Error('no string version')
  return manifest.version
}

expect(result.stdout.trim()).toBe(`attw v${manifestVersion}`)
```

Checks that held for this fix: `pnpm check:ci` exits 0; the tsdown bundle and the nix artifact both print `attw v4.1.0` (`.#attw`), where the pre-fix bundle printed `attw v1.1.1` for the same manifest.

Code smells to grep for on any bundled entry:

- a version-shaped string literal in a bundled entry (`version: '1.1.1'`)
- a `package.json` path reached at runtime by a package whose `files` list excludes it
- a package whose tsconfig extends a `tsc/*` preset while its build tool is a bundler
- a version assertion whose expected value comes from the artifact under test rather than from its source

## Related

- `docs/solutions/tooling-decisions/self-name-imports-type-aware-lint.md` — why a specifier whose default target is a build artifact makes its gates depend on the build; the same reasoning selects the preset here.
- `docs/solutions/tooling-decisions/test-only-dev-dependency-inflates-the-build-path.md` — what moves a package onto the build critical path; the nix artifact and the bundle are the artifacts this assertion reads.
