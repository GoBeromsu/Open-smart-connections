<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/domain

## Purpose
Business logic layer for open-connections. Contains all embedding domain logic, entity data model, and the Redux-style embedding state machine. **No `obsidian` imports** — all Obsidian type dependencies are shimmed via `src/types/obsidian-shims.ts`.

## Key Files

| File | Description |
|------|-------------|
| `config.ts` | DEFAULT_SETTINGS, NOTICE_CATALOG, error classes |
| `embed-model.ts` | EmbedModel + EmbedAdapterRegistry (provider registration) |
| `embedding-pipeline.ts` | Batch embedding pipeline — processes queued entities |
| `embed-error.ts` | Typed embedding error hierarchy |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `entities/` | Data model: Source, Block, EntityCollection, SQLite adapter, markdown splitter (see `entities/AGENTS.md`) |
| `embedding/kernel/` | Redux-style state machine: store, reducer, selectors, effects (see `embedding/kernel/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **Never import from `obsidian`** — ESLint `no-restricted-imports` enforces this
- Use shim interfaces from `src/types/obsidian-shims.ts` for Obsidian types
- `EmbedAdapterRegistry` in `embed-model.ts` is the registration point for all providers — adapters self-register from `src/ui/embed-adapters/`

## Dependencies
- `src/types/` — obsidian-shims.ts for FileRef, NoteMetadata interfaces
- `src/utils/` — cos_sim, create_hash, results_acc
