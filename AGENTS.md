<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-28 -->

# open-connections

## Purpose
Open Smart Connections — Obsidian plugin that uses local embeddings (Transformers.js via srcdoc iframe, WebGPU Metal-3 confirmed) to surface semantically related notes. Provides a **Connections** view (related notes) and **Lookup** view (semantic search). Embedding runs in-browser with no external API required.

## Key Files

| File | Description |
|------|-------------|
| `src/main.ts` | Composition root — SmartConnectionsPlugin class, lifecycle, commands, views |
| `src/domain/config.ts` | DEFAULT_SETTINGS, NOTICE_CATALOG, error classes |
| `src/domain/embed-model.ts` | EmbedModel + EmbedAdapterRegistry |
| `src/domain/embedding-pipeline.ts` | Batch embedding pipeline |
| `src/domain/flat-vector-index.ts` | In-memory Float32Array vector index — cosine similarity search (5-15ms, yields every 1000 vectors) |
| `src/ui/ConnectionsView.ts` | Related notes panel (ItemView) |
| `src/ui/LookupView.ts` | Semantic search panel (ItemView) |
| `src/ui/embed-orchestrator.ts` | Facade exports for the flattened embedding/runtime helper surface |
| `src/ui/collection-loader.ts` | Source/Block collection init and chunked loading |
| `src/ui/plugin-initialization.ts` | 3-phase init: Phase 1 (core), Phase 2 (embedding), Phase 3 (background block import) |
| `src/ui/settings.ts` | Settings tab with live embedding status |
| `src/ui/embed-adapters/transformers-connector.ts` | EMBED_CONNECTOR string with [SC:GPU] diagnostic logging |
| `src/types/obsidian-augments.d.ts` | Typed workspace event overloads — eliminates as-any casts |
| `esbuild.js` | Build config (CJS, ES2018, vault copy in watch mode) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Source layers (see `src/AGENTS.md`) |
| `src/domain/` | Business logic — NO obsidian imports (see `src/domain/AGENTS.md`) |
| `src/domain/entities/` | EmbeddingSource, EmbeddingBlock, EntityCollection, SQLite adapter (see `src/domain/entities/AGENTS.md`) |
| `src/domain/embedding/kernel/` | Kernel barrel + types for embedding queue/model helpers (see `src/domain/embedding/kernel/AGENTS.md`) |
| `src/ui/` | Obsidian-dependent views, modals, commands, settings, adapters (see `src/ui/AGENTS.md`) |
| `src/ui/embed-adapters/` | Provider adapters (see `src/ui/embed-adapters/AGENTS.md`) |
| `src/types/` | Pure type definitions + obsidian-augments.d.ts (see `src/types/AGENTS.md`) |
| `src/utils/` | Pure utility functions (see `src/utils/AGENTS.md`) |
| `scripts/` | Autoresearch harness scripts (check-freeze, check-webgpu, check-connections, check-e2e) |
| `test/` | Vitest unit + sqlite-integration tests |

## For AI Agents

### Working In This Directory
- 4-layer architecture enforced by ESLint `no-restricted-imports`: `domain/`, `types/`, `utils/` must NEVER import `obsidian`
- Custom workspace events (e.g. `open-connections:embed-progress`) are typed in `src/types/obsidian-augments.d.ts` — no `as any` casts on event names
- Shared contracts, docs, and harnesses still come from `obsidian-boiler-template`, but runtime helper implementations now stay repo-local under `src/ui/`
- Embedding kernel (`domain/embedding/kernel/`) is now a slim barrel/types surface; queue and model helpers were flattened outward
- 3-phase initialization: Phase 1 (core, blocking), Phase 2 (embedding, background), Phase 3 (deferred block import via setTimeout 5s)
- UI is usable before Phase 2 completes; blocks are imported in Phase 3 background
- Vector search uses in-memory `FlatVectorIndex` when safe; oversized indexes must fall back to SQLite nearest-query behavior instead of risking memory blowups
- Large behavior-preserving refactors must land as very small checkpoint commits; do not mix wide file moves with logic changes
- Prefer tests/static enforcement as the main proof, and use `obsidian-cli` runtime smoke only for behavior that tests cannot fully prove (default vault for smoke: `Test`)
- WebGPU confirmed active (Metal-3, fp32) — `[SC:GPU]` diagnostic logging in EMBED_CONNECTOR, queryable via `get_gpu_diag`

### Testing Requirements
```bash
pnpm run ci          # build + lint + test (must pass before any commit)
pnpm run test        # Vitest unit tests (382 tests, ~4s)
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # ESLint — 0 errors required
```

### Autoresearch Harness Scripts (Karpathy-style)
```bash
bash scripts/check-freeze.sh Test       # Plugin loads without UI freeze
bash scripts/check-webgpu.sh Test       # WebGPU backend active (Metal-3)
bash scripts/check-connections.sh Test  # 3 files show connections (50 results, <5s)
bash scripts/check-e2e.sh Test          # Full pipeline: sources + blocks + embedding
```
Each harness: build → deploy → boot Obsidian → eval check → PASS/FAIL. Freeze detection via eval timeout.

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
- `obsidian-boiler-template` — source of truth for shared contracts, docs, and harnesses

### External
- `obsidian` — Obsidian Plugin API
- `@huggingface/transformers@3.8.0` — Transformers.js (CDN-loaded in srcdoc iframe, WebGPU Metal-3)
- `node:sqlite` — SQLite storage (Node built-in, Electron 39.5.1+)
- `vitest` — test runner
