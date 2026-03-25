<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# domain/embedding/kernel

## Purpose
Redux-style state machine for the embedding subsystem. Holds the authoritative embedding phase state, dispatches typed events, and drives side effects (model loading, job queuing, progress reporting). The kernel is the single source of truth for embedding status — UI components subscribe via workspace events, never poll directly.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | `EmbeddingKernelStore` — holds state, `dispatch()`, `getState()`, `subscribe()`; also exports queue and effects wiring |
| `types.ts` | `EmbeddingKernelState`, `EmbeddingEvent` union type, phase enum |

## For AI Agents

### Working In This Directory
- **No `obsidian` imports** — pure TypeScript state machine
- Dispatch typed events via `store.dispatch(event)` — never mutate state directly
- UI subscribes to state changes via `smart-connections:embed-state-changed` workspace event (fired by effects in `index.ts`)
- Phase transitions: `idle → loading → ready → running → idle` (with `error` branch)

### Common Patterns
```typescript
// Dispatch a typed event
store.dispatch({ type: 'MODEL_LOADED', payload: { fingerprint, modelKey } });

// Read current state
const { phase, progress } = store.getState();

// Subscribe to state changes (from UI layer)
plugin.app.workspace.on('open-connections:embed-state-changed', (payload) => { ... });
```

## Dependencies
- Consumed by `src/ui/embed-orchestrator.ts` — dispatches events, reads state
- Consumed by `src/ui/status-bar.ts` — subscribes for UI updates
