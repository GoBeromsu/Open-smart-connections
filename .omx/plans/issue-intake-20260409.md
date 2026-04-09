# Live Issue Intake Ledger — Open Connections

> Draft only. Do not post these to GitHub yet.

This ledger captures issue candidates the user describes in chat. Keep each entry short, timestamped, and ready to promote into either a draft issue or a deferred backlog bullet.

## Operating rules
- Capture only user-described candidates from chat or mailbox relays.
- Keep each entry to: title, why it matters, evidence, and next action.
- If the candidate is immediate and actionable, promote it to a concise issue draft.
- If the candidate is broader or should wait, promote it to a backlog bullet instead.
- Do not post directly to GitHub from this file.

## Current state
- Status: captured 3 candidates; draft queue open
- Owner: worker-1
- Last updated: 2026-04-09T20:39:00+09:00
- Classification so far: refactor and feature; no bug candidate captured yet.
- GitHub issues posted: 1

## Intake log
| Time (KST) | Candidate | Classification | Evidence / notes | Next step |
| --- | --- | --- | --- | --- |
| 2026-04-09 20:34 | Profile Obsidian CLI performance before changing behavior | refactor | User wants profiling and performance optimization via Obsidian CLI. | Draft refactor issue copy |
| 2026-04-09 20:34 | Group concurrency settings by provider | feature | User wants concurrency controls to be scoped per provider. | Draft feature issue copy |
| 2026-04-09 20:39 | Replace text-input folder exclusions with a folder picker UI | feature | User wants the folder exclusion UX moved to a picker, with confirm/remove behavior and auto re-embed on list removal. | Posted to GitHub as #72 |

## Draft queue

### Refactor
- **Title:** Profile the Obsidian CLI execution path and optimize the slow path
- **Problem:** We suspect the CLI-driven flow has avoidable overhead, but we need profiling before changing behavior.
- **Next step:** Capture profiling evidence and identify the highest-impact hotspots.

### Feature
- **Title:** Group concurrency settings by provider
- **Problem:** Concurrency needs to be tuned per provider instead of as one global value.
- **Next step:** Define provider-scoped settings and fallback defaults.

### Posted GitHub issue
- **Title:** Replace text-input folder exclusions with a folder picker UI
- **Issue:** #72
- **Problem:** Folder exclusions should be managed through a picker UI with explicit confirm/remove behavior and existing re-embed flow on list removal.
- **Next step:** Track feedback on the posted issue and refine if the user adds more detail.

### Bug
- No confirmed bug candidate in this intake yet.

## Promotion targets
- **Issue draft**: use when the candidate is concrete enough to become GitHub-ready copy later.
- **Backlog bullet**: use when the idea is useful but should stay deferred for now.
