# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Release model

### Workspace

The set of packages this repository version-controls and releases together. Only a workspace package that declares a name and a version and is not marked private is eligible for release; tool-only packages are workspace members but never release candidates.

### Change intent

A file recording that a workspace package is owed a release, authored alongside the change that earns it. It names a package and a bump level — `none` records a change that needs no release. An intent is not itself a release: it is consumed when the Release PR lands, and consumption is recorded separately from the intent file, so the presence of an intent never by itself implies a pending release.

_Avoid:_ changeset — the file format is a changeset, but the concept here is the recorded intent to release.

### Release set

The workspace packages owed a release in the current run — those whose manifest version is not yet served by the package registry. Membership is a fact about the registry, not about version control: a package leaves the set when its version is published, never when a branch advances or a tag is written.

### Release phase

The stage the release pipeline decides it is in, derived rather than configured. `publish` when the release set is non-empty; `version` when nothing is owed but unconsumed change intents remain; `none` when neither holds. Each phase gates a distinct job, so a phase derived from a wrong signal skips work silently rather than failing. An intent file that still exists after consumption is recorded is not pending.

### Published version

A version the package registry serves for a package. The registry is the authority on this: neither a git tag nor a changelog file establishes it, and both are written downstream of a successful publish.

### Git tag as release evidence

Rejected as a release signal. Tags are written _after_ the step that a missing tag would cause to fail, so a detector reading tag absence cannot make its own precondition true. Recorded here because the term still appears in the pipeline's history and in older workflow steps.

## Registry resolution

### Registry probe

A query against the package registry asking whether a given package version is published. It has three outcomes, not two: published, unpublished, and _cannot tell_. The last is a failure, never a "no" — folding it into unpublished reclassifies a published package as owed a release.

### Scoped name

A package name carrying a scope, written `@scope/name`. A scoped name is a single path segment in a registry URL, so the scope separator must be percent-encoded rather than left literal.
