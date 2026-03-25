<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/utils

## Purpose

Pure utility functions for open-connections. Zero state, zero side effects, zero external dependencies. All functions are deterministic and testable in isolation. No `obsidian` imports.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | cos_sim, cos_sim_f32, create_hash, average_vectors, results_acc, sort_by_score, error helpers, install date detection |

## Subdirectories

None — single file utilities module.

## For AI Agents

### Working In This Directory

- **NO `obsidian` imports** — enforced by ESLint `no-restricted-imports`
- All functions are pure: same inputs → same outputs, no side effects
- No state mutations, no external dependencies
- Optimized for performance where applicable (e.g., cos_sim_f32 for typed array performance)
- All functions include JSDoc comments with parameter types and return types

### Key Functions

| Function | Purpose |
|----------|---------|
| `cos_sim(v1, v2)` | Cosine similarity between vectors (number[] or Float32Array) |
| `cos_sim_f32(v1, v2)` | Fast cosine similarity for Float32Array (avoids JS boxing) |
| `create_hash(text)` | SHA-256 hash of text content (async) |
| `average_vectors(vecs)` | Element-wise average of multiple vectors |
| `results_acc(acc, result, count)` | Top-k accumulator — maintains highest-scoring results |
| `sort_by_score_descending(a, b)` | Comparator for descending score sort |
| `errorMessage(e)` | Extract string from unknown thrown value |
| `determine_installed_at(current, ctime)` | Resolve install date from multiple sources |

### Testing

All functions are covered by unit tests in `test/utils.test.ts` and `test/cos-sim-f32.test.ts`. Test utility functions in isolation with no mocks.

## Dependencies

None — pure JavaScript, no external packages
