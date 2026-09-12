# Proposal: G6 in `check_ttsr_rule.ts` is inverted against its own definition and fixtures

Owner: the maintainer of the `ttsr-rules` skill (`/root/.omp/agent/skills/ttsr-rules`). This is a
**proposal and a wait** — the checker is a judgment surface, so the author of the rule that
found the defect must not edit it (CONST-E9).

## The defect

`scripts/check_ttsr_rule.ts` line 139-145:

```ts
const hasReissue = /re-?issue/i.test(body)
rows.push({
  gate: 'G6',
  pass: !hasReissue,
  evidence: hasReissue
    ? 're-issue clause present — consumer does not get a choice'
    : 'no re-issue clause',
})
```

`references/gate-definitions.md` states the opposite predicate:

```
## G6 — a re-issue clause exists
predicate:  /re-?issue/i matches the body
```

## The fixtures prove which one is wrong

Run against `assets/fixtures/one-violation-per-gate/`:

- `valid-baseline.md` — the fixture that must produce **zero** findings — contains the re-issue
  clause ("Re-issue only when … Same-turn re-issue is not a new trigger.") and **FAILS G6**.
- `g6-no-reissue-clause.md` — the fixture that must produce exactly one finding, on G6 —
  **PASSES G6** (`PASS g6-no-reissue-clause G6 no re-issue clause`).

Every other fixture also fails G6 with "re-issue clause present — consumer does not get a
choice", so the gate's known-bad/known-good proof (skill rule V1) does not hold for G6.

## Why it matters

`G6` is the only gate enforcing `EH1`. With the predicate inverted, a rule author is pushed to
delete the re-issue clause that `EH1` requires, and a rule missing the clause scores a clean
verdict. The failure is silent in both directions.

## Ask

Either invert the predicate to `pass: hasReissue` with the evidence strings restored to match
`gate-definitions.md`, or — if the policy genuinely changed to "bodies must not coach re-issue" —
update `gate-definitions.md`, `SKILL.md` rule `EH1`, the fixture `g6-no-reissue-clause.md`, and
`valid-baseline.md` together, so the doc, the gate, and the fixtures agree.

## How this was found

Authoring `/root/.omp/agent/rules/no-characterization.md` (re-issue clause present, per `EH1`);
the rule scores 7/8 gates with G6 the only failure, and the fixtures confirm the gate, not the
rule, is wrong.
