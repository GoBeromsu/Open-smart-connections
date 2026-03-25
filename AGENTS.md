<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# open-connections

## Purpose
Open Smart Connections — Obsidian plugin that uses local embeddings (Transformers.js via Web Worker, WebGPU/WASM) to surface semantically related notes. Provides a **Connections** view (related notes) and **Lookup** view (semantic search). Embedding runs in-browser with no external API required.

## Key Files

| File | Description |
|------|-------------|
| `src/main.ts` | Composition root — SmartConnectionsPlugin class, lifecycle, commands, views |
| `src/domain/config.ts` | DEFAULT_SETTINGS, NOTICE_CATALOG, error classes |
| `src/domain/embed-model.ts` | EmbedModel + EmbedAdapterRegistry |
| `src/domain/embedding-pipeline.ts` | Batch embedding pipeline |
| `src/ui/ConnectionsView.ts` | Related notes panel (ItemView) |
| `src/ui/LookupView.ts` | Semantic search panel (ItemView) |
| `src/ui/embed-orchestrator.ts` | Model lifecycle, embed jobs, phase transitions |
| `src/ui/collection-loader.ts` | Source/Block collection init and chunked loading |
| `src/ui/settings.ts` | Settings tab with live embedding status |
| `src/types/obsidian-augments.d.ts` | Typed workspace event overloads — eliminates as-any casts |
| `worker/embed-worker.ts` | Transformers.js Web Worker (WebGPU → WASM fallback) |
| `esbuild.js` | Build config (CJS, ES2018, vault copy in watch mode) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Source layers (see `src/AGENTS.md`) |
| `src/domain/` | Business logic — NO obsidian imports (see `src/domain/AGENTS.md`) |
| `src/domain/entities/` | EmbeddingSource, EmbeddingBlock, EntityCollection, SQLite adapter (see `src/domain/entities/AGENTS.md`) |
| `src/domain/embedding/kernel/` | Redux-style embedding state machine (see `src/domain/embedding/kernel/AGENTS.md`) |
| `src/ui/` | Obsidian-dependent views, modals, commands, settings, adapters (see `src/ui/AGENTS.md`) |
| `src/ui/embed-adapters/` | Provider adapters (see `src/ui/embed-adapters/AGENTS.md`) |
| `src/types/` | Pure type definitions + obsidian-augments.d.ts (see `src/types/AGENTS.md`) |
| `src/utils/` | Pure utility functions (see `src/utils/AGENTS.md`) |
| `src/shared/` | Boiler-template synced files — DO NOT EDIT (see `src/shared/AGENTS.md`) |
| `worker/` | Transformers.js embed worker |
| `test/` | Vitest unit + sqlite-integration tests |

## For AI Agents

### Working In This Directory
- 4-layer architecture enforced by ESLint `no-restricted-imports`: `domain/`, `types/`, `utils/` must NEVER import `obsidian`
- Custom workspace events (e.g. `open-connections:embed-progress`) are typed in `src/types/obsidian-augments.d.ts` — no `as any` casts on event names
- `src/shared/` is synced from `obsidian-boiler-template` — never edit directly
- Embedding kernel (`domain/embedding/kernel/`) uses Redux-style pattern: dispatch events, reducer handles transitions
- Phase 1 (core, blocking) vs Phase 2 (embedding, background) initialization — UI is usable before Phase 2 completes

### Testing Requirements
```bash
pnpm run ci          # build + lint + test (must pass before any commit)
pnpm run test        # Vitest unit tests (260 tests, ~4s)
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # ESLint — 0 errors required
```

### Common Patterns
```typescript
// Workspace event (typed via augments — no as-any needed)
plugin.app.workspace.trigger('open-connections:embed-progress', payload);

// Private settings shape without any
(settings as unknown as { _connections_session?: SessionState })._connections_session

// EntityCollection — .all is already T[], no cast needed
const entities = this.block_collection.all; // EmbeddingBlock[]
```

## Dependencies

### Internal
- `obsidian-boiler-template` — source of truth for `src/shared/` files

### External
- `obsidian` — Obsidian Plugin API
- `@xenova/transformers` — Transformers.js (in Web Worker)
- `node:sqlite` — SQLite storage (Node built-in, Electron 39.5.1+)
- `vitest` — test runner
