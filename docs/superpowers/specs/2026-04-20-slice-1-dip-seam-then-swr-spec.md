# Spec: Slice 1 — DIP Seam, then SWR Results Cache

> Derived from `2026-04-20-reader-mutator-problem-definition.md` §8 (4-slice roadmap).
> Slice 1 only. Writer placement, broader `types/` split, and deep ISP decomposition are **deferred to Slice 2+**.

## Objective

Break the tight coupling between `ConnectionsView` and `SmartConnectionsPlugin`'s public fields so the view can be unit-tested, and land the Philosophy §5 "Stale-While-Revalidate" posture for the Connections panel.

**Why this slice is first.** Feathers, *Working Effectively with Legacy Code*: "to get a test around code, you must break its dependencies". Today `ConnectionsView` transitively pulls `obsidian` through `view.plugin.block_collection.for_source(...)`, so any characterization test of the render pipeline needs either (a) a full `SmartConnectionsPlugin` stand-in or (b) deep per-test mocks of the whole plugin graph. Both are brittle. Introducing a narrow `ConnectionsReader` port (DIP) unlocks cheap stubs, which unlocks TDD for the SWR cache.

**Concrete user-visible outcome.** When the user flips between two already-embedded notes, the Connections panel must not flash "loading → results". The result set must be served from cache for the currently-indexed (path, fingerprint) key and revalidate silently in the background when the embedding kernel reports `running → idle` (§5 of Philosophy: results-focused, SWR).

**Execution rule (clarified 2026-04-20).** Treat the current Slice 1 spec as the default scope target, but if TDD evidence shows a spec item is not causally tied to the screen-transition freeze and fixing it now would raise behavior-risk, default to **freeze reduction + behavior preservation first** and defer that item explicitly. Adjacent cleanup is allowed only when it directly enables the tests or the freeze-focused refactor. Release metadata (`manifest.json`, versioning, release scripts) stays out of scope.

## Tech Stack

- TypeScript (strict), Node ≥ 18, pnpm workspaces
- esbuild 0.21 bundler (CJS, ES2018)
- Vitest 1.x + jsdom 24 for unit/integration tests
- ESLint 9 flat config with `no-restricted-imports` layer walls
- Obsidian plugin runtime (target desktop + mobile)

## Commands

```bash
pnpm install                                # once
pnpm run typecheck                          # tsc --noEmit
pnpm run lint                               # ESLint src/ + worker/
pnpm run test                               # Vitest single-run
pnpm vitest run test/<file>.test.ts         # single file
pnpm run ci                                 # build + lint + test (gate before commit/push)
pnpm run dev                                # vault-selecting dev loop (only if manual QA needed)
```

All verification steps in the plan call `pnpm run typecheck` + the relevant `pnpm vitest run` file. `pnpm run ci` gates each commit on green.

## Project Structure (Slice 1 deltas only)

```
src/
├── types/
│   └── connections-reader.ts         # NEW — port (DIP). Pure TS, NO obsidian import.
├── domain/
│   └── connections/
│       ├── result-cache.ts           # NEW — pure (path, fingerprint) → ConnectionResult[] cache
│       └── render-orchestration.ts   # NEW — pure decision: serve-from-cache vs. revalidate
├── ui/
│   ├── ConnectionsView.ts            # MODIFY — constructor takes reader; events call orchestration
│   ├── connections-view-state.ts     # MODIFY — accept reader instead of view.plugin.* reads
│   └── connections-reader-adapter.ts # NEW — wraps plugin into ConnectionsReader (composition root)
└── main.ts                           # MODIFY — pass adapter to registerView factory

test/
├── mocks/
│   └── obsidian.ts                   # MODIFY — add Workspace.trigger() (Phase E)
├── connections-reader-adapter.test.ts          # NEW
├── connections-result-cache.test.ts            # NEW
├── connections-render-orchestration.test.ts    # NEW
├── connections-view-state.characterization.test.ts  # NEW
└── connections-view-swr.integration.test.ts    # NEW (Phase D capstone)
```

All new source files ≤ 200 LOC (docs/rules.md R4). `src/types/connections-reader.ts` MUST NOT import `obsidian` (ESLint-enforced).

## Code Style

Reader port (DIP, with one explicit test-enabling brownfield seam for on-demand block hydration):

```ts
// src/types/connections-reader.ts
import type { ConnectionResult } from './entities';
import type { EmbeddingBlockLike, EmbeddingSourceLike } from './obsidian-shims';
import type { ParsedEmbedRuntimeState, EmbedStatePhase } from './embed-runtime';

export interface ConnectionsReader {
  isReady(): boolean;
  isEmbedReady(): boolean;
  getStatusState(): 'ok' | 'error' | string;
  hasPendingReImport(path: string): boolean;
  getBlocksForSource(path: string): EmbeddingBlockLike[];
  getSource(path: string): EmbeddingSourceLike | null;
  ensureBlocksForSource(path: string): Promise<readonly EmbeddingBlockLike[]>;
  getConnectionsForSource(path: string, limit?: number): Promise<readonly ConnectionResult[]>;
  getEmbedRuntimeState(): ParsedEmbedRuntimeState | null;
  getSearchModelFingerprint(): string | null;
  getKernelPhase(): EmbedStatePhase;      // 'idle' | 'running' | 'error' — SWR driver
  isDiscovering(): boolean;               // covers ConnectionsView.ts:117 `_discovering` read
}
```

Pure cache (one responsibility):

```ts
// src/domain/connections/result-cache.ts
export class ConnectionsResultCache {
  private readonly store = new Map<string, { fingerprint: string; results: readonly ConnectionResult[] }>();
  get(path: string, fingerprint: string): readonly ConnectionResult[] | null { /* exact (path, fp) match only */ }
  set(path: string, fingerprint: string, results: readonly ConnectionResult[]): void { /* ... */ }
  invalidate(path: string): void { /* ... */ }
  invalidateAll(): void { /* ... */ }
}
```

Render orchestration — pure decision (no DOM, no async):

```ts
// src/domain/connections/render-orchestration.ts
export type RenderDecision =
  | { kind: 'serve_cached'; results: readonly ConnectionResult[] }
  | { kind: 'compute_fresh' }
  | { kind: 'revalidate_in_background'; staleResults: readonly ConnectionResult[] };

export function decideRender(
  input: { path: string; fingerprint: string; kernelPhase: 'idle' | 'running' | 'error' },
  cache: ConnectionsResultCache,
): RenderDecision { /* explicit match on (cache-hit? × fingerprint-change? × phase) */ }
```

Conventions:
- Types in `src/types/**` are the contract; no behavior there.
- Domain modules are pure; no `obsidian`, no `window`, no `setTimeout`.
- UI modules do the I/O: DOM writes, workspace events, timers.
- Each function/class gets one test file with multiple `describe` blocks per behavior.

## Testing Strategy

**Levels.** From bottom up:

| Level | Scope | Isolation mechanism | Target |
|-------|-------|---------------------|--------|
| L0 — unit (pure) | `result-cache.ts`, `render-orchestration.ts` | none needed; pure TS | 100 % branch |
| L1 — unit (adapter) | `connections-reader-adapter.ts` | fake plugin object (plain literal) | 100 % method |
| L2 — unit (state) | `connections-view-state.ts::deriveConnectionsViewState` | fake `ConnectionsReader` | each `ViewState` variant ≥ 1 test |
| L3 — integration | `ConnectionsView.renderView` characterization | `ConnectionsView` + jsdom + fake reader + Workspace mock | each event-driven path |
| L4 — SWR capstone | Full view + cache + orchestrator | fake reader + `Workspace.trigger()` seam | §5 SWR invariants |

**Characterization first.** Phase B captures *today's* behavior before any cache is added. This guards against accidental regressions when Phase C/D replace render logic.

**Mock-usage rules (steel-manning from Phase E plan):**
- `test/mocks/obsidian.ts` gets a real `trigger(name, payload?)` that walks `on()` handlers. Without this, revalidation tests would either couple to private method calls or pass falsely when no handler is present.
- `ConnectionsReader` in every view test is a plain object literal, not a `vi.mock('../main')`. This keeps tests readable and refactor-resilient.

**Coverage floor.** Slice 1 must not lower repo coverage. Current thresholds (vitest.config.ts): statements 60 %, branches 68 %, functions 50 %. The new pure modules should exceed 95 %.

## Boundaries

**Always do**
- Follow docs/rules.md R1–R6. Every new file justifies its existence and stays ≤ 200 LOC.
- Respect the ESLint layer walls: `src/domain/**`, `src/types/**`, `src/utils/**` may not import `obsidian`.
- Run `pnpm run ci` before every commit listed in the plan.
- Keep each commit atomic around one bite-sized task (writing-plans discipline).
- Use characterization/TDD evidence to justify any broadened cleanup beyond the narrow seam/cache path.
- Use superpowers subagent-driven-development for execution; dispatch `code-reviewer` + `verifier` between phase boundaries.

**Ask first**
- Any Slice-2 scope leak (writer placement, broader Reader surface, moving types across layers).
- Bumping vitest coverage thresholds.
- Touching `manifest.json` version, release scripts, or GitHub Actions.
- Cutting a new branch from `issue-74-ataraxia-state-latency` vs. continuing on it (the tree is currently dirty on that branch).

**Never do**
- Introduce `obsidian` import into `src/types/**` or `src/domain/**`.
- Remove or weaken `no-restricted-imports` ESLint rules.
- Replace the existing `updateConnectionsProgressBanner` test pattern (it is the blueprint; don't rewrite it).
- Skip characterization tests (Phase B) and go directly to Phase C — we'd lose the regression net.
- Force through a Slice 1 item that lacks a freeze/testability justification when the evidence says it raises behavior risk.
- Bundle write-side changes (`import_source_blocks`, `data_adapter.save`, `autoQueueBlockEmbedding`) into Slice 1.

## Success Criteria

Slice 1 is done when *all* of the following are objectively true:

1. `src/types/connections-reader.ts` exists, exports `ConnectionsReader`, and is imported by both `ConnectionsView.ts` and `connections-view-state.ts`. No production file passes `view.plugin.block_collection` into the render path.
2. `connections-reader-adapter.ts` is instantiated exactly once in `main.ts` and passed to `ConnectionsView`'s constructor. ESLint + tsc pass.
3. `ConnectionsResultCache` and `decideRender` are pure (no Obsidian, no globals) and covered by ≥ 95 % branches.
4. Re-opening the same note twice with no fingerprint change calls `container.empty()` **zero times** after the first render (verified via L4 integration test with jsdom + spy).
5. A `running → idle` transition on `open-connections:embed-state-changed` invalidates the path's cache entry and triggers exactly one re-render (L4 integration test).
6. A fingerprint change (e.g. model switch) invalidates all cache entries and shows a loading banner before the next results arrive.
7. `pnpm run ci` is green. Coverage does not drop below current thresholds.
8. `test/mocks/obsidian.ts` has a working `Workspace.trigger()` that calls registered handlers.
9. A `code-reviewer` subagent and a `verifier` subagent both sign off on the diff in separate passes (no same-context self-approval).

## Open Questions

| # | Question | Default assumption if unresolved |
|---|----------|-----------------------------------|
| OQ-1 | Should Slice 1 surface a subtle "revalidating…" indicator in the UI when the kernel is running but we serve from cache? | **No indicator.** Reuse existing progress banner for running-phase messaging; keep results pane stable. |
| OQ-2 | Cut a new branch off `main` for Slice 1 or continue on `issue-74-ataraxia-state-latency`? | **Ask before cutting.** Commit or stash current dirty files first. |
| OQ-3 | Where does the `EmbeddingBlockLike`/`EmbeddingSourceLike` shim live? New file in `types/` or extend `types/obsidian-shims.ts`? | Extend `types/obsidian-shims.ts` (fewer files, same owner). |
| OQ-4 | Do we collapse the 10 call sites of `for_source(path)` to go through the Reader in Slice 1? | **No.** Only the ConnectionsView render path is rerouted; bulk migration is Slice 2. |
| OQ-5 | What is the cache eviction policy? | LRU with `max=64` entries, clearable via `invalidateAll()`. (Revisit if profile shows GC pressure.) |

---

**Next artifact:** `docs/superpowers/plans/2026-04-20-slice-1-dip-seam-then-swr.md` (the TDD-granular plan) is derived from this spec. Update this spec first when anything changes; the plan follows.
