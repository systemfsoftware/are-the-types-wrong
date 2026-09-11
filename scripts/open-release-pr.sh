#!/usr/bin/env bash
set -euo pipefail

: "${BRANCH:?}"
: "${BASE:?}"
: "${GH_TOKEN:?}"

existing=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')

if [ -z "$(git status --porcelain)" ]; then
  echo "no pending change intents — nothing to release"
  if [ -n "$existing" ]; then
    gh pr close "$existing" --delete-branch --comment "No pending change intents remain."
  fi
  exit 0
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git switch --force-create "$BRANCH"
git add -A -- packages .changeset pnpm-lock.yaml
git commit -m 'chore(release): version packages'
git push --force origin "$BRANCH"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
cat > "$body" <<'BODY'
Consumes pending `.changeset/` intents via `pnpm version -r`.

Merging runs the gate, then builds, publishes (OIDC + provenance),
and tags the changed packages.

Review every consumed `none` intent before merging — a `none` on a
behavior-visible change is a silent non-release.

Packages not registered as npm trusted publishers fail at publish
with an OIDC auth error; register them at https://www.npmjs.com
against workflow `release.yml` in this repository.
BODY

gh label create release \
  --color 0E8A16 \
  --description 'Automated version-packages release PR' \
  --force

if [ -n "$existing" ]; then
  gh pr edit "$existing" \
    --title 'chore(release): version packages' \
    --body-file "$body" \
    --add-label release
else
  gh pr create \
    --base "$BASE" \
    --head "$BRANCH" \
    --title 'chore(release): version packages' \
    --body-file "$body" \
    --label release
fi
