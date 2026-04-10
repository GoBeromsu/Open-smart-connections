<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/ui

## Purpose
Obsidian-dependent UI layer for open-connections. Contains all views, settings, commands, file watchers, status bar, and embedding adapter integrations. May freely import from `obsidian`. Bridges the domain layer to the Obsidian runtime.

## Key Files

| File | Description |
|------|-------------|
| `ConnectionsView.ts` | Related notes side panel (ItemView) |
| `LookupView.ts` | Semantic search side panel (ItemView) |
| `settings.ts` | Settings tab with live embedding status section |
| `settings-model-picker.ts` | Embedding model selection component in settings |
| `embed-orchestrator.ts` | Model lifecycle, adapter wiring, phase transitions, job dispatch |
| `collection-loader.ts` | Source/Block collection initialization and chunked loading |
| `commands.ts` | Obsidian command registrations |
| `status-bar.ts` | Status bar item — shows embedding phase/progress |
| `file-watcher.ts` | Vault file change events → embedding queue |
| `user-state.ts` | Persists per-user UI state (connections session, filter) |
| `block-connections.ts` | Block-level connection display logic |
| `embed-progress.ts` | Embedding progress payload builder |
| `result-context-menu.ts` | Right-click context menu on result items |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `embed-adapters/` | Provider adapters (transformers, openai, gemini, ollama, etc.) — see `embed-adapters/AGENTS.md` |

## For AI Agents

### Working In This Directory
- May import from `obsidian` — this is the Obsidian-dependent layer
- Custom workspace events typed in `src/types/obsidian-augments.d.ts` — no `as any` on event names
- `embed-orchestrator.ts` is the facade entrypoint and activates adapters via side-effect imports — add new adapters there
- Settings tab (`settings.ts`) uses live event listeners — clean them up in `unregisterEmbedStatus()`

## Dependencies
- `src/domain/` — business logic, entity model, embedding kernel
- `src/types/obsidian-augments.d.ts` — typed workspace event overloads
- `src/ui/plugin-logger.ts` and `src/ui/plugin-notices.ts` provide the repo-local notice/logging helpers used by `main.ts`
