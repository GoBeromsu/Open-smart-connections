<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src

## Purpose

Composition and layer organization for open-connections. Contains the 4-layer architecture: domain (business logic), ui (Obsidian-dependent), types (pure types), and utils (pure functions). Main entry point `main.ts` wires all layers together.

## Key Files

| File | Description |
|------|-------------|
| `main.ts` | Composition root — SmartConnectionsPlugin class, lifecycle, commands, views |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `domain/` | Business logic — NO obsidian imports; config, embed model, pipeline, entities, embedding kernel |
| `ui/` | Obsidian-dependent code — views, modals, settings, commands, file watchers, embed adapters |
| `types/` | Pure type definitions — NO obsidian imports (except obsidian-augments.d.ts which augments) |
| `utils/` | Pure utility functions — NO obsidian imports, zero state, zero side effects |

## For AI Agents

### Working In This Directory

- **4-layer architecture enforced by ESLint `no-restricted-imports`**:
  - `domain/` — NO `obsidian` imports
  - `types/` — NO `obsidian` imports (obsidian-augments.d.ts is declaration-only augmentation)
  - `utils/` — NO `obsidian` imports
  - `ui/` — may import `obsidian`
  - `main.ts` — may import `obsidian` (composition root)

- **Dependency flow is one-way**:
  ```
  utils/ ──┐
  types/ ──┼── domain/ ── ui/ ── main.ts
  ```

- Repo-local notice/logging helpers live in `ui/` and may be consumed by `main.ts`.

- Obsidian type references in domain/types/utils are satisfied via shim interfaces in `src/types/obsidian-shims.ts` (structural typing)

- Custom workspace events are typed in `src/types/obsidian-augments.d.ts` via module augmentation — no `as any` casts needed
- Behavior-preserving refactors should prefer structural tests and lint rules first; use runtime smoke only when tests cannot fully prove a runtime-sensitive path
- When flattening structure, keep move-only commits separate from logic-simplification commits

### Common Patterns

```typescript
// Domain layer (NO obsidian import)
import type { FileRef, NoteMetadata } from '../types/obsidian-shims';

// UI layer (safe to import obsidian)
import { TFile, App } from 'obsidian';

// Workspace event with proper typing
plugin.app.workspace.trigger('open-connections:embed-progress', payload);

// Accessing unshaped settings without any-cast
(settings as unknown as { _session?: SessionState })._session
```

## Dependencies

### Internal
- `obsidian-boiler-template` remains the source of truth for shared contracts, docs, and harnesses

### External
- `obsidian` — Obsidian Plugin API (imported only by `ui/` and `main.ts`)
- `@xenova/transformers` — Transformers.js (in Web Worker)
- `node:sqlite` — SQLite storage (Electron 39.5.1+)
- `vitest` — test runner
