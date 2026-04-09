# Embedding Pipeline Philosophy and Rules

This document defines the maintainability-first philosophy for `open-connections` embedding-pipeline work.

It exists to keep future changes small, testable, and reversible.

## Philosophy

### 1. Simplify for maintainability, not novelty
- Simplification is justified only when it makes the pipeline easier to reason about, test, debug, and maintain.
- A simpler pipeline should reduce hidden state, duplicated UI state, and surprise side effects.
- `obsidian-qmd` may be used as a **reference** for calm status surfaces and sequencing ideas, but it is **not** a blueprint to copy wholesale.

### 2. Correctness before cleanup
- First prove that excluded content stops entering discovery and watcher-driven re-import paths.
- Only after correctness is stable should the team decide how to handle already-indexed stale content.
- Do not hide cleanup semantics inside a correctness fix.

### 3. Explicit beats implicit
- Destructive or wide-scope behavior must be explicit.
- If a change can remove stored indexed content, it needs a clear trigger, guardrails, and verification.
- Silent bulk cleanup is a product decision, not a maintenance detail.

### 4. One authoritative progress surface
- Detailed embedding progress belongs in **Settings**.
- Other surfaces should stay terse and contextual.
- The pipeline should not expose multiple competing “live dashboard” views for the same run.

### 5. Small verified slices
- The pipeline must evolve in small, independently verifiable slices.
- Every slice should be small enough to explain in one commit and easy enough to revert without collateral cleanup.

## Rules

## Rule 1 — Work in commit-sized success units
- One success unit should contain one narrow claim.
- A success unit is done only after:
  - targeted tests pass,
  - runtime verification passes when the slice touches behavior,
  - the diff is still narrow and reviewable.
- Commit after each green success unit.

## Rule 2 — Large changes become issues first
- If a change is too large, destructive, or cross-cutting for one success unit, stop and split it into an issue.
- Use issues for:
  - explicit exclusion cleanup workflow,
  - deeper pipeline simplification/performance instrumentation,
  - broad progress-UX follow-ups,
  - any change that needs preview/confirmation or schema-level work.

## Rule 3 — Preserve the stage order
Use this order unless a verified blocker forces a change:

1. latest-version baseline
2. exclusion helper semantics
3. discovery + watcher guards
4. prune-semantics decision
5. narrow pipeline simplification
6. settings-as-SSOT progress UX

Do not jump ahead to later slices while an earlier boundary is still failing or ambiguous.

## Rule 4 — Do not auto-prune in the first slice
- Exclusion changes should first block future discovery and re-import.
- Automatic bulk prune is out of scope until there is:
  - a clear policy,
  - a safe trigger,
  - verification for edge cases,
  - and explicit approval for destructive behavior.

## Rule 5 — Keep Connections View results-focused
- Settings owns detailed progress.
- Connections View should focus on results and, at most, a lightweight qualitative notice such as “index updating” or “results may be stale.”
- Status bar should remain a terse summary/error hint, not a second detailed progress dashboard.

## Rule 6 — Runtime verification is mandatory for behavioral slices
For any slice that changes runtime behavior, verify with the Obsidian CLI:

- `plugin:reload`
- `dev:errors`
- `dev:console`
- `eval`
- `dev:screenshot` and/or `dev:dom` when UI proof is needed

Behavior is not considered proven by unit tests alone.

## Rule 7 — Stop at the first failing boundary
- If a slice fails, isolate that boundary first.
- Do not compensate by widening scope or partially implementing later slices.
- Fix the failing boundary, then re-run the same verification ladder.

## Rule 8 — Prefer maintainable observability over user-facing noise
- Add instrumentation only when it improves diagnosis or verification.
- Avoid turning internal pipeline activity into constant user-facing noise.
- Performance work should measure queue depth, elapsed time, save cadence, and UI churn without creating new distracting surfaces.

## Verification Checklist

Before considering a pipeline change complete, confirm:

- [ ] the slice still matches a narrow success unit
- [ ] targeted tests passed
- [ ] runtime verification passed if behavior changed
- [ ] no larger hidden follow-up was bundled in
- [ ] any oversized follow-up was turned into an issue draft
- [ ] the rationale still supports maintainability over novelty

## Maintainer Note

When in doubt:

1. make the smaller change,
2. verify it in runtime,
3. commit the green slice,
4. turn the rest into issues.
