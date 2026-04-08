<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# domain/embedding/kernel

## Purpose
Focused helpers for the embedding subsystem's queueing and model fingerprinting. This directory currently provides the embedding job queue plus normalized model fingerprint construction, and should keep each responsibility in its own file.

## Key Files

| File | Description |
|------|-------------|
| `build-kernel-model.ts` | Normalizes adapter/model/host into a stable fingerprint |
| `embedding-kernel-job-queue.ts` | In-memory priority queue with dedupe/inflight tracking |
| `index.ts` | Barrel exports only |
| `types.ts` | `EmbeddingKernelJob` type definitions |

## For AI Agents

### Working In This Directory
- **No `obsidian` imports** — pure TypeScript helpers only
- Keep `index.ts` barrel-only; do not reintroduce queue/model logic there
- Queue behavior lives in `embedding-kernel-job-queue.ts`
- Model fingerprint normalization lives in `build-kernel-model.ts`

### Common Patterns
```typescript
const queue = new EmbeddingKernelJobQueue();
const model = buildKernelModel('openai', 'text-embedding-3-small', '', 1536);
await queue.enqueue({ type: 'RUN_EMBED_BATCH', key: model.fingerprint, priority: 10, run });
```

## Dependencies
- Consumed by `src/main.ts` and embedding runtime helpers for queueing/model fingerprinting
