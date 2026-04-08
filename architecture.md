# Open Connections Architecture

> Agent-first first-read document for this repository.
> This file should let an agent understand the current system boundary **without** scanning the whole codebase first.
> For the current change stream, the governing rule is: **type-first clarification now, architecture migration later**.

## Overview

- **Purpose**: Obsidian plugin for semantic related-note discovery and semantic lookup.
- **Primary user surfaces**:
  - **Connections View** — related-note panel for the active note
  - **Lookup View** — semantic search
- **Current risk area**: runtime embedding/backfill failures can currently collapse into a generic “model failed to initialize” presentation, which makes system tracking and degraded behavior hard to reason about.

## Layer Map

```text
src/types  -> shared runtime and domain-facing types
src/utils  -> pure helpers
src/domain -> pure business logic, entities, pipeline, kernel job types
src/ui     -> Obsidian-facing orchestration, views, settings, status surfaces
src/main.ts -> composition root / plugin runtime
```

## Dependency Direction

```text
utils/ ──┐
types/ ──┼── domain/ ── ui/ ── main.ts
shared/ ─┘               │
                          └── shared/
```

Rules:
- `domain/`, `types/`, and `utils/` must not import `obsidian`.
- `ui/` may depend on `domain/`, `types/`, `utils/`, and `shared/`.
- `main.ts` is the composition root and may bridge every layer.
- `shared/` is boiler-template synced; avoid edits there unless the change belongs in the template itself.

## Runtime State Domains

The runtime must distinguish **three different concerns** that were previously too easy to collapse together:

1. **Model readiness**
   - Is an embedding model available for new embedding/query work?
   - Examples: warming up, ready, unavailable

2. **Embedding / backfill execution health**
   - Is background embedding idle, running, or failed?
   - This is about backlog processing, not query-serving by itself.

3. **Serving availability**
   - Can the user still get meaningful Connections / Lookup behavior right now?
   - This includes degraded states where existing indexed data can still be served even though background embedding failed.

### Why this split matters

The user-facing failure that triggered this work was not a literal model-init failure. Runtime evidence showed a failure during `Auto embed blocks for connections view`, while the UI still collapsed the result into a generic model-init/settings message. That ambiguity makes both debugging and future agent work harder.

## Current Phase Boundary

### Phase 1 — Type-first clarification (current scope)
- Add this `architecture.md`.
- Make runtime states explicit in `src/types/embed-runtime.ts`.
- Thread those parsed/refined states into the views and status surfaces that currently depend on loosely coupled booleans.
- Preserve current user-visible Connections View query-serving behavior.

### Later phase — Architecture migration / behavioral repair
- Restructure broader module boundaries only after type/state contracts are explicit.
- Revisit deeper behavior changes (auto-embed strategy, migration lanes, retry semantics, backlog orchestration) from the safer type-explicit base.

## Parse, Don’t Validate

This repository should prefer **refinement** over repeated late branching.

Bad pattern:
- many callers separately infer meaning from `phase`, `embed_ready`, and `lastError`
- UI layers reconstruct inconsistent truth from the same raw fields

Preferred pattern:
- parse raw runtime state once into a typed interpretation
- downstream code consumes that parsed interpretation
- invalid or ambiguous combinations become impossible or at least explicit

## Serving Invariant

**Connections View query-serving is sacred.**
If a note already has indexed embeddings, the view should keep serving those results even if a later background embedding/backfill run fails.

Corollary:
- “backfill failed” is not automatically the same as “query-serving unavailable”
- “model unavailable” is not automatically the same as “no existing results can be shown”

## Practical Change Guidance

When changing runtime state behavior:
- add or update the explicit runtime types first
- keep status/bar/settings/view messaging aligned to the same parsed source of truth
- avoid architecture migration-by-stealth in this phase
- document any later migration work separately instead of bundling it into the type clarification diff
