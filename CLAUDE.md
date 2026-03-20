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
1. Bundles `src/app/main.ts` to `dist/main.js` using esbuild (CJS format, ES2018 target)
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

```
src/
├── app/                    # Plugin entry point and core orchestration
│   ├── main.ts             # SmartConnectionsPlugin (extends Plugin)
│   ├── commands.ts         # Command palette registrations
│   ├── config.ts           # DEFAULT_SETTINGS
│   ├── notices.ts          # SmartConnectionsNotices (catalog + mute support)
│   ├── settings.ts         # Settings tab UI
│   ├── settings-model-picker.ts  # Embedding model picker component
│   ├── status-bar.ts       # Status bar widget
│   ├── file-watcher.ts     # Vault file change handlers
│   └── user-state.ts       # Install date, version tracking, update checks
├── features/
│   ├── connections/
│   │   └── ConnectionsView.ts   # ItemView: related notes for active file
│   ├── embedding/
│   │   ├── collection-manager.ts # Source/Block collection init and loading
│   │   ├── embedding-manager.ts  # Model lifecycle, embed jobs, pipeline
│   │   ├── kernel/               # Embedding state machine (Redux-style)
│   │   │   ├── store.ts          # EmbeddingKernelStore
│   │   │   ├── reducer.ts        # State transitions
│   │   │   ├── effects.ts        # Side-effect logging
│   │   │   ├── selectors.ts      # Derived state queries
│   │   │   ├── queue.ts          # EmbeddingKernelJobQueue
│   │   │   └── types.ts          # State/Event type definitions
│   │   └── queue/
│   │       └── embed-job-queue.ts  # EmbedJobQueue (async job scheduling)
│   └── lookup/
│       └── LookupView.ts        # ItemView: semantic search across vault
├── shared/
│   ├── entities/                 # Data model (Source, Block, Collection)
│   │   ├── EmbeddingSource.ts    # Source entity (one per vault file)
│   │   ├── EmbeddingBlock.ts     # Block entity (heading sections)
│   │   ├── EmbeddingEntity.ts    # Shared base class
│   │   ├── SourceCollection.ts   # Source collection
│   │   ├── BlockCollection.ts    # Block collection
│   │   ├── EntityCollection.ts   # Abstract collection base
│   │   ├── adapters/             # PGlite data adapter
│   │   └── parsers/              # Markdown splitter
│   ├── models/embed/             # EmbedModel + adapters
│   │   ├── EmbedModel.ts         # Abstract embed model
│   │   └── adapters/             # transformers, openai, ollama, gemini, etc.
│   ├── search/                   # Search logic
│   │   ├── find-connections.ts   # Cosine-sim connections for a source
│   │   ├── lookup.ts             # Semantic lookup by query string
│   │   ├── vector-search.ts      # Low-level vector search
│   │   └── embedding-pipeline.ts # Batch embedding pipeline
│   ├── types/                    # Shared TypeScript types
│   ├── errors.ts                 # Custom error classes
│   └── utils/                    # Utility functions (cos_sim, hashing, etc.)
├── views/
│   └── result-context-menu.ts    # Right-click context menu for results
├── utils/                        # UI utilities (icons, banner, drag)
└── styles.css                    # Plugin CSS

worker/
└── embed-worker.ts           # Web Worker for Transformers.js embedding
                              # WebGPU -> WASM fallback chain
                              # JSON-RPC: load, unload, embed_batch, count_tokens

test/                         # Vitest tests (co-located in test/ directory)
├── *.test.ts                 # Unit/integration tests
├── mocks/                    # Test mocks
└── setup.ts                  # Vitest setup
```

### Initialization Flow

`SmartConnectionsPlugin.onload()` registers views, commands, settings tab, and ribbon icon, then delegates to `initialize()`:

- **Phase 1 (Core, blocking):** load user state, wait for Obsidian Sync, init collections from PGlite storage, setup status bar, register file watchers.
- **Phase 2 (Embedding, background):** initialize embedding model, download Transformers.js assets if needed, queue unembedded entities. Phase 1 is usable before Phase 2 completes.

### Embedding Kernel

The embedding subsystem uses a Redux-style state machine (`features/embedding/kernel/`):
- `EmbeddingKernelStore` holds the current state and dispatches typed events.
- `reducer.ts` handles state transitions (INIT_CORE_READY, MODEL_LOADED, EMBED_STARTED, EMBED_PROGRESS, etc.).
- `selectors.ts` exposes derived queries like `isEmbedReady()` and `toLegacyStatusState()`.
- UI components subscribe via `smart-connections:embed-state-changed` workspace event.

## Notices

`plugin.notices` is a `PluginNotices` instance (from `src/shared/plugin-notices.ts`, synced from boiler template). The catalog of all notice types is defined in `src/app/notices.ts` as `NOTICE_CATALOG`. `SmartConnectionsNotices` is just a type alias for `PluginNotices`.

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
| `src/app/main.ts` | Plugin class: lifecycle, commands, views, embedding orchestration |
| `src/app/notices.ts` | NOTICE_CATALOG + SmartConnectionsNotices alias (wraps shared PluginNotices) |
| `src/shared/plugin-notices.ts` | Shared PluginNotices (synced from boiler template — do not edit) |
| `src/shared/plugin-logger.ts` | Shared PluginLogger (synced from boiler template — do not edit) |
| `src/app/config.ts` | DEFAULT_SETTINGS |
| `src/features/connections/ConnectionsView.ts` | Connections panel (related notes) |
| `src/features/lookup/LookupView.ts` | Semantic search panel |
| `src/features/embedding/kernel/store.ts` | Embedding state machine |
| `src/shared/entities/` | Source/Block entity model + PGlite adapter |
| `src/shared/models/embed/` | EmbedModel + provider adapters |
| `src/shared/search/` | find-connections, lookup, vector-search |
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
