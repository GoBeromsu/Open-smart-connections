<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/domain/embedding

## Purpose

Embedding state machine and job scheduling. Contains the Redux-style embedding kernel (store, reducer, selectors, effects, event types) and the async job queue for managing embedding tasks. No `obsidian` imports — pure domain logic.

## Key Files

None at this level — all logic is in `kernel/` subdirectory.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `kernel/` | Redux-style embedding state machine: store, reducer, selectors, effects, queue (see `kernel/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- This is an intermediate container directory — it only holds the `kernel/` subdirectory
- All embedding state logic is in `kernel/AGENTS.md`
- Do not add files directly here; follow the `kernel/` organization

### Common Patterns

```typescript
// Dispatch events to the embedding kernel
store.dispatch({ type: 'INIT_CORE_READY' });

// Subscribe to state changes via workspace event
plugin.app.workspace.on('open-connections:embed-state-changed', (payload) => {
  console.log(`phase: ${payload.phase}, prev: ${payload.prev}`);
});

// Query current state via selectors
const isReady = selectors.isEmbedReady(state);
const phase = selectors.getPhase(state);
```

## Dependencies

- `src/types/` — entities, models, settings, obsidian-shims
- `src/utils/` — cos_sim, create_hash, results_acc
