This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Git strategy, branch naming, commit convention, and release management are defined in the **root CLAUDE.md**. This file covers plugin-specific details only.

## Project Overview

Open Smart Connections is an Obsidian plugin (TypeScript, esbuild) that uses local embeddings to surface semantically related notes. It provides a **Connections** view showing notes related to the current file and a **Lookup** view for semantic search across the vault. Embedding runs in-browser via a Web Worker using Transformers.js (WebGPU with WASM fallback).

## Build Commands

```bash
pnpm run dev           # vault selection + esbuild watch + hot reload (delegate mode)
pnpm run dev:build     # esbuild watch only (no vault interaction)
pnpm run build         # production build -> dist/ (single-shot)
pnpm run test          # Vitest unit tests
pnpm run test:watch    # Vitest in watch mode
pnpm run lint          # ESLint (src/ and worker/)
pnpm run lint:fix      # ESLint with auto-fix
pnpm run ci            # build + lint + test (must pass before release)
pnpm run typecheck     # tsc --noEmit
pnpm run typecheck:watch  # tsc --noEmit --watch
```

The build process (`esbuild.js`):
1. Bundles `src/main.ts` to `dist/main.js` using esbuild (CJS format, ES2018 target)
2. Syncs `manifest.json` version from `package.json`
3. Copies `manifest.json`, `src/styles.css`, and `embed-worker.js` to `dist/`
4. In watch mode, copies output to vaults listed in `DESTINATION_VAULTS` env var and touches `.hotreload`

## Release

1. `pnpm ci` -- MUST pass (build + lint + test)
2. `pnpm release:patch|minor|major` -- lint:fix, version bump, auto-push tag
3. GitHub Actions handles CI + Release workflows

**DENIED by settings.json:** `git tag`, `git push --tags`, `gh release` -- only `pnpm release:*` is allowed.

## Local Development

`pnpm dev` uses the unified dev orchestrator (`scripts/dev.mjs`) in delegate mode:
1. Discovers Obsidian vaults, lets you select one interactively
2. Sets `DESTINATION_VAULTS` env var with the selected vault path
3. Runs `dev:build` (esbuild --watch) which handles vault sync internally

Alternatively, set `DESTINATION_VAULTS` directly in `.env`:
```
DESTINATION_VAULTS=my-test-vault,another-vault
```

Use `VAULT_PATH`, `VAULT_NAME`, or `--vault <name>` to skip interactive selection.

## Architecture

The codebase follows a strict 4-layer architecture enforced by ESLint `no-restricted-imports`:

| Layer | Path | Rule |
|-------|------|------|
| Composition root | `src/main.ts` | Wires all layers together |
| Domain | `src/domain/` | NO `obsidian` imports — pure business logic |
| UI | `src/ui/` | Obsidian-dependent views, modals, settings |
| Types | `src/types/` | NO `obsidian` imports — pure type definitions |
| Utils | `src/utils/` | NO `obsidian` imports — pure functions, zero state |
| Shared | `src/shared/` | Boiler-template synced files only — DO NOT EDIT |

```
src/
├── main.ts                   # Composition root — SmartConnectionsPlugin (extends Plugin)
├── domain/                   # Business logic — NO obsidian imports
│   ├── config.ts             # DEFAULT_SETTINGS
│   ├── notices.ts            # NOTICE_CATALOG + SmartConnectionsNotices alias
│   ├── errors.ts             # TransientError, FatalError
│   ├── entities/             # Data model (Source, Block, Collection, adapters, parsers)
│   │   ├── EmbeddingEntity.ts
│   │   ├── EmbeddingSource.ts
│   │   ├── EmbeddingBlock.ts
│   │   ├── SourceCollection.ts
│   │   ├── BlockCollection.ts
│   │   ├── EntityCollection.ts
│   │   ├── adapters/         # SQLite (sql.js WASM) data adapter
│   │   └── parsers/          # Markdown heading splitter
│   ├── search/               # Search and embedding logic
│   │   └── embedding-pipeline.ts # Batch embedding pipeline
│   ├── models/embed/         # Abstract EmbedModel + registry (no adapters here)
│   │   ├── EmbedModel.ts
│   │   ├── registry.ts
│   │   └── index.ts
│   └── embedding/
│       ├── kernel/           # Redux-style embedding state machine
│       │   ├── store.ts      # EmbeddingKernelStore
│       │   ├── reducer.ts    # State transitions
│       │   ├── effects.ts    # Side-effect logging
│       │   ├── selectors.ts  # Derived state queries
│       │   ├── queue.ts      # EmbeddingKernelJobQueue
│       │   └── types.ts      # State/Event type definitions
│       └── queue/
│           └── embed-job-queue.ts  # EmbedJobQueue (async job scheduling)
├── ui/                       # Obsidian-dependent code
│   ├── settings.ts           # Settings tab UI
│   ├── settings-model-picker.ts  # Embedding model picker component
│   ├── commands.ts           # Command palette registrations
│   ├── status-bar.ts         # Status bar widget
│   ├── file-watcher.ts       # Vault file change handlers
│   ├── user-state.ts         # Install date, version tracking, update checks
│   ├── connections/
│   │   └── ConnectionsView.ts   # ItemView: related notes for active file
│   ├── lookup/
│   │   └── LookupView.ts        # ItemView: semantic search across vault
│   ├── embedding/
│   │   ├── collection-manager.ts # Source/Block collection init and loading
│   │   └── embedding-manager.ts  # Model lifecycle, embed jobs, pipeline
│   ├── models/embed/adapters/   # API adapters (use requestUrl — Obsidian-dependent)
│   │   ├── _api.ts           # Shared fetch helper
│   │   ├── transformers.ts   # Local WebWorker adapter
│   │   ├── openai.ts, gemini.ts, ollama.ts, lm_studio.ts, open_router.ts, upstage.ts
│   └── views/
│       └── result-context-menu.ts  # Right-click context menu for results
├── types/                    # Pure type definitions — NO obsidian imports
│   ├── entities.ts
│   ├── models.ts
│   ├── settings.ts
│   ├── obsidian-shims.ts     # Structural shims: TFileShim, VaultShim, etc.
│   └── index.ts
├── utils/                    # Pure utility functions — NO obsidian imports
│   ├── cos_sim.ts, create_hash.ts
│   ├── results_acc.ts, sort_by_score.ts, determine_installed_at.ts
│   └── index.ts
└── shared/                   # Boiler-template synced — DO NOT EDIT
    ├── plugin-logger.ts
    ├── plugin-notices.ts
    ├── settings-migration.ts
    ├── debounce-controller.ts
    └── styles.base.css

worker/
└── embed-worker.ts           # Web Worker for Transformers.js embedding
                              # WebGPU -> WASM fallback chain
                              # JSON-RPC: load, unload, embed_batch, count_tokens

test/                         # Vitest tests (co-located in test/ directory)
├── *.test.ts                 # Unit/integration tests
├── mocks/                    # Test mocks
└── setup.ts                  # Vitest setup
```

### Layer Boundary Rules

- `domain/`, `types/`, `utils/` must never import from `obsidian` — enforced by ESLint `no-restricted-imports`
- Entity classes in `domain/entities/` use shim interfaces from `types/obsidian-shims.ts` instead of real Obsidian types (structural typing — no runtime difference)
- Adapter self-registration (side effects) is triggered in `ui/embedding/embedding-manager.ts` via `import './models/embed/adapters/transformers'` etc.

### Initialization Flow

`SmartConnectionsPlugin.onload()` registers views, commands, settings tab, and ribbon icon, then delegates to `initialize()`:

- **Phase 1 (Core, blocking):** load user state, wait for Obsidian Sync, init collections from SQLite storage, setup status bar, register file watchers.
- **Phase 2 (Embedding, background):** initialize embedding model, download Transformers.js assets if needed, queue unembedded entities. Phase 1 is usable before Phase 2 completes.

### Embedding Kernel

The embedding subsystem uses a Redux-style state machine (`domain/embedding/kernel/`):
- `EmbeddingKernelStore` holds the current state and dispatches typed events.
- `reducer.ts` handles state transitions (INIT_CORE_READY, MODEL_LOADED, EMBED_STARTED, EMBED_PROGRESS, etc.).
- `selectors.ts` exposes derived queries like `isEmbedReady()` and `toLegacyStatusState()`.
- UI components subscribe via `smart-connections:embed-state-changed` workspace event.

## Notices

`plugin.notices` is a `PluginNotices` instance (from `src/shared/plugin-notices.ts`, synced from boiler template). The catalog of all notice types is defined in `src/domain/notices.ts` as `NOTICE_CATALOG`. `SmartConnectionsNotices` is just a type alias for `PluginNotices`.

- Muted notice IDs are persisted under `settings.plugin_notices.muted`.
- Existing `smart_notices.muted` entries are migrated on first load.
- CSS uses `plugin-notice*` class names (not `osc-notice*`).
- A `PluginLogger` instance is available as `plugin.logger`.

Usage:
```typescript
// Show a cataloged notice with parameters
plugin.notices.show('embedding_progress', {
  adapter: 'transformers',
  modelKey: 'all-MiniLM-L6-v2',
  current: 42,
  total: 100,
  percent: 42,
});

// Show with action button
plugin.notices.show('update_available', { tag_name: 'v3.2.0' }, {
  button: { text: 'Update', callback: () => { /* ... */ } },
});

// Remove a notice programmatically
plugin.notices.remove('embedding_progress');

// Mute/unmute (persisted in plugin settings)
await plugin.notices.mute('embedding_progress');
await plugin.notices.unmuteAll();
```

## Testing

Tests use Vitest and live in `test/` (`.test.ts` files). Run a single test:
```bash
pnpm vitest run test/notices.test.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin class: lifecycle, commands, views, embedding orchestration |
| `src/domain/notices.ts` | NOTICE_CATALOG + SmartConnectionsNotices alias (wraps shared PluginNotices) |
| `src/shared/plugin-notices.ts` | Shared PluginNotices (synced from boiler template — do not edit) |
| `src/shared/plugin-logger.ts` | Shared PluginLogger (synced from boiler template — do not edit) |
| `src/domain/config.ts` | DEFAULT_SETTINGS |
| `src/types/obsidian-shims.ts` | Structural shims for TFile, Vault, MetadataCache — used by domain layer |
| `src/ui/connections/ConnectionsView.ts` | Connections panel (related notes) |
| `src/ui/lookup/LookupView.ts` | Semantic search panel |
| `src/domain/embedding/kernel/store.ts` | Embedding state machine |
| `src/domain/entities/` | Source/Block entity model + SQLite adapter |
| `src/domain/models/embed/` | Abstract EmbedModel + registry |
| `src/ui/models/embed/adapters/` | Provider adapters (transformers, openai, ollama, gemini, etc.) |
| `src/domain/search/` | embedding-pipeline |
| `worker/embed-worker.ts` | Transformers.js Web Worker |
| `esbuild.js` | Build config (CSS/markdown plugins, vault copy) |
| `scripts/dev.mjs` | Dev orchestrator (vault discovery + delegate) |
| `scripts/version.mjs` | Version bump script |

## Resources

- Obsidian Plugin API Docs: https://docs.obsidian.md/Home

## Hot Reload

- `pnpm dev` uses delegate mode: injects `DESTINATION_VAULTS` env, build script handles sync
- `DESTINATION_VAULTS` in `.env` also works for direct `pnpm dev:build`
- `.hotreload` file triggers Obsidian change detection
