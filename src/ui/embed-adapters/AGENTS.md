<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# ui/embed-adapters

## Purpose
Provider-specific adapters that implement the `EmbedAdapter` interface for each supported embedding backend. All adapters use Obsidian's `requestUrl` (not `fetch`) for HTTP calls. Self-registration via side-effect imports in `embed-orchestrator.ts`.

## Key Files

| File | Description |
|------|-------------|
| `api-base.ts` | Abstract `ApiEmbedAdapter` base class — shared HTTP logic, response parsing, error handling |
| `transformers.ts` | Local Transformers.js adapter — communicates with `worker/embed-worker.ts` via MessageChannel |
| `openai.ts` | OpenAI text-embedding-3-* adapter |
| `gemini.ts` | Google Gemini text-embedding adapter |
| `ollama.ts` | Ollama local model adapter (REST API) |
| `lm-studio.ts` | LM Studio local model adapter (OpenAI-compatible API) |
| `open-router.ts` | OpenRouter cloud gateway adapter |
| `upstage.ts` | Upstage Solar embedding adapter |

## For AI Agents

### Working In This Directory
- All adapters **must use `requestUrl`** from `obsidian` — never `fetch` or `node:http`
- Self-registration pattern: each file calls `EmbedAdapterRegistry.register(...)` at module load. Import the adapter in `embed-orchestrator.ts` to activate it.
- Extend `api-base.ts` for new HTTP-based providers — never duplicate the request/retry logic
- `transformers.ts` uses `Worker` + `MessageChannel` — keep Web Worker protocol changes in sync with `worker/embed-worker.ts`

### Common Patterns
```typescript
// Adding a new provider:
// 1. Extend ApiEmbedAdapter in a new file
// 2. Implement embed(texts: string[]): Promise<number[][]>
// 3. Call EmbedAdapterRegistry.register('my-provider', MyAdapter) at the bottom
// 4. Add import in embed-orchestrator.ts: import './embed-adapters/my-provider'
```

## Dependencies
- `src/domain/embed-model.ts` — `EmbedAdapterRegistry` for self-registration
- `worker/embed-worker.ts` — Transformers.js worker protocol (transformers adapter only)
- `obsidian` — `requestUrl` for all HTTP calls
