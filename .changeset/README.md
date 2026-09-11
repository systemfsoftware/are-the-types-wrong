# Changesets

This directory holds change-intent files consumed by pnpm-native workspace
versioning (`pnpm version -r`). One file per change, authored with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A PR that changes anything under `packages/` MUST ship with an intent here.
  Root tooling is outside the verdict.
- `--bump none` records a change that needs no release. A `none` on a
  behavior-visible change is the same silent non-release the gate exists to
  catch.
- Intents are consumed by `pnpm version -r` when the Release PR
  lands: consumption is recorded in `ledger.yaml` and the intent files
  are retained, so a present intent alone never implies a pending release.
- This README is NOT a changeset: the gate requires a file whose frontmatter
  parses as `"<pkg>": <none|patch|minor|major>`.

Publishing uses npm OIDC trusted publishing from `.github/workflows/release.yml`.
Register `@TODO/starter` (TODO: your package name) as a trusted publisher on npmjs.com
pointing at this repository and that workflow filename before the first new
version can ship. OIDC cannot debut a package npm has never seen.
