<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# domain/embedding/kernel

## Purpose
Slim barrel/types surface for the embedding kernel. Queue and model fingerprint helpers have been flattened out; this directory now keeps only the kernel barrel and its shared types.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel exports only |
| `types.ts` | `EmbeddingKernelJob` type definitions |

## For AI Agents

### Working In This Directory
- **No `obsidian` imports** — pure TypeScript helpers only
- Keep `index.ts` barrel-only; do not reintroduce queue/model logic there
- Queue behavior now lives in `src/domain/embedding-kernel-job-queue.ts`
- Model fingerprint normalization now lives in `src/domain/build-kernel-model.ts`

### Common Patterns
```typescript
const queue = new EmbeddingKernelJobQueue();
const model = buildKernelModel('openai', 'text-embedding-3-small', '', 1536);
await queue.enqueue({ type: 'RUN_EMBED_BATCH', key: model.fingerprint, priority: 10, run });
```

## Dependencies
- Consumed by `src/main.ts` and embedding runtime helpers for queueing/model fingerprinting
