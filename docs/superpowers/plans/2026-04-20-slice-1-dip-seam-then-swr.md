# Slice 1 — DIP Seam, then SWR Results Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a narrow `ConnectionsReader` port (DIP) in the view/state layer, then TDD-build a Stale-While-Revalidate results cache on top of it — without touching the write-side (Slice 2).

**Architecture:** Three new seams — a Reader port in `src/types/`, a pure `ConnectionsResultCache` + pure `decideRender` in `src/domain/connections/`, and a composition-root adapter in `src/ui/`. The UI view consumes the Reader via its constructor, the render pipeline consults the cache, and the existing workspace event bus drives revalidation.

**Tech Stack:** TypeScript, Vitest + jsdom, ESLint flat-config layer walls, esbuild, Obsidian plugin runtime.

**Spec:** `open-connections/docs/superpowers/specs/2026-04-20-slice-1-dip-seam-then-swr-spec.md`

**Clarified execution rule (2026-04-20 deep-interview).**
- Default to completing the current spec, but only through a **tests-first / characterization-first** sequence.
- When evidence shows a spec item is not causally tied to the screen-transition freeze and fixing it now would increase behavior risk, prefer **freeze reduction + behavior preservation first** and defer that item explicitly.
- Broaden cleanup only when it directly enables the tests or the freeze-focused refactor.
- Do not touch `manifest.json`, versioning, release scripts, or release workflow concerns in this flow.

---

## Phase 0 — Preparatory Exploration (single subagent, read-only)

### Task 0.1: Finalize the Reader surface by grepping every ConnectionsView plugin read

**Files:**
- Read-only (no writes)

- [ ] **Step 1: Dispatch `Explore` subagent**

```
Agent(subagent_type="Explore", thoroughness="very thorough",
  description="Finalize ConnectionsReader surface",
  prompt="""
Grep open-connections/src/ui/ConnectionsView.ts and src/ui/connections-view-state.ts for every
read of `view.plugin.*` or `this.plugin.*`. Produce an exhaustive list grouped by:
  (A) block/source data lookups
  (B) plugin-lifecycle flags (ready, embed_ready, status_state, _discovering)
  (C) embedding-kernel state (getEmbedRuntimeState, _embed_state, _search_embed_model.fingerprint)
  (D) pending-import tracking (pendingReImportPaths)
For each call, give file:line and the exact expression. Then propose the MINIMAL ConnectionsReader
interface that covers only the READ paths in those two files (ignore writes). Flag any plugin field
that is NOT a read (i.e. a method call with side effects) so we keep it OUT of Slice 1.
Output ≤ 300 words + a typed interface block.
"""
)
```

- [ ] **Step 2: Reconcile subagent output with spec's Reader sketch**

Confirm `ConnectionsReader` in the spec matches or strictly widens the subagent's proposal. If the subagent found a READ not in the sketch, add it to the spec (update §"Code Style") before proceeding. If the subagent found a WRITE we missed, flag it — it belongs in Slice 2.

- [ ] **Step 3: Commit the spec update only (if any)**

```bash
git add open-connections/docs/superpowers/specs/2026-04-20-slice-1-dip-seam-then-swr-spec.md
git commit -m "docs(spec): finalize ConnectionsReader surface from Phase-0 recon"
```

---

## Phase A — Seam Introduction (Reader port → adapter → view wiring)

### Task A.1: Define `ConnectionsReader` port

**Files:**
- Create: `open-connections/src/types/connections-reader.ts`
- Modify: `open-connections/src/types/obsidian-shims.ts` (add `EmbeddingBlockLike`, `EmbeddingSourceLike` if not present; keep ≤ 200 LOC)
- Test: `open-connections/test/connections-reader.types.test.ts`

- [ ] **Step 1: Write the failing type-level test**

```ts
// test/connections-reader.types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { ConnectionsReader } from '../src/types/connections-reader';

describe('ConnectionsReader port', () => {
  it('exposes read-only methods and no mutators', () => {
    expectTypeOf<ConnectionsReader['isReady']>().toEqualTypeOf<() => boolean>();
    expectTypeOf<ConnectionsReader['hasPendingReImport']>().toEqualTypeOf<(p: string) => boolean>();
    // @ts-expect-error — mutators must not exist on the reader
    type NoMutator = ConnectionsReader['importSourceBlocks'];
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/connections-reader.types.test.ts`
Expected: FAIL — cannot resolve `../src/types/connections-reader`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/types/connections-reader.ts
import type { ParsedEmbedRuntimeState, EmbedStatePhase } from './embed-runtime';
import type { EmbeddingBlockLike, EmbeddingSourceLike } from './obsidian-shims';

export interface ConnectionsReader {
  isReady(): boolean;
  isEmbedReady(): boolean;
  getStatusState(): string;
  hasPendingReImport(path: string): boolean;
  getBlocksForSource(path: string): EmbeddingBlockLike[];
  getSource(path: string): EmbeddingSourceLike | null;
  ensureBlocksForSource(path: string): Promise<readonly EmbeddingBlockLike[]>;
  getConnectionsForSource(path: string, limit?: number): Promise<readonly ConnectionResult[]>;
  getEmbedRuntimeState(): ParsedEmbedRuntimeState | null;
  getSearchModelFingerprint(): string | null;
  getKernelPhase(): EmbedStatePhase;   // 'idle' | 'running' | 'error' — SWR input
  isDiscovering(): boolean;            // replaces ConnectionsView.ts:117 plugin._discovering read
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/connections-reader.types.test.ts && pnpm run typecheck && pnpm run lint`
Expected: all green. No `obsidian` import added to `src/types/**`.

- [ ] **Step 5: Commit**

```bash
git add src/types/connections-reader.ts src/types/obsidian-shims.ts test/connections-reader.types.test.ts
git commit -m "feat(types): add ConnectionsReader port (DIP seam, no obsidian import)"
```

### Task A.2: Implement `connections-reader-adapter.ts` in the composition root

**Files:**
- Create: `open-connections/src/ui/connections-reader-adapter.ts`
- Test: `open-connections/test/connections-reader-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/connections-reader-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { createConnectionsReader } from '../src/ui/connections-reader-adapter';

describe('createConnectionsReader', () => {
  const fakePlugin = {
    ready: true,
    embed_ready: false,
    status_state: 'ok',
    pendingReImportPaths: new Set(['a.md']),
    block_collection: { for_source: (p: string) => (p === 'x.md' ? [{ has_embed: () => true }] : []) },
    source_collection: { get: (p: string) => (p === 'x.md' ? { path: 'x.md' } : null) },
    getEmbedRuntimeState: () => ({ serving: { kind: 'ready' } }),
    _search_embed_model: { fingerprint: 'fp-1' },
  } as any;

  it('exposes plugin reads through the Reader surface', () => {
    const r = createConnectionsReader(fakePlugin);
    expect(r.isReady()).toBe(true);
    expect(r.isEmbedReady()).toBe(false);
    expect(r.hasPendingReImport('a.md')).toBe(true);
    expect(r.hasPendingReImport('b.md')).toBe(false);
    expect(r.getBlocksForSource('x.md')).toHaveLength(1);
    expect(r.getSource('x.md')?.path).toBe('x.md');
    expect(r.getEmbedRuntimeState()?.serving.kind).toBe('ready');
    expect(r.getSearchModelFingerprint()).toBe('fp-1');
  });

  it('returns null when optional fields are absent', () => {
    const r = createConnectionsReader({ ready: false } as any);
    expect(r.isReady()).toBe(false);
    expect(r.getSource('y.md')).toBeNull();
    expect(r.getEmbedRuntimeState()).toBeNull();
    expect(r.getSearchModelFingerprint()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/connections-reader-adapter.test.ts`
Expected: FAIL — `createConnectionsReader` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/connections-reader-adapter.ts
import type SmartConnectionsPlugin from '../main';
import type { ConnectionsReader } from '../types/connections-reader';

export function createConnectionsReader(plugin: SmartConnectionsPlugin): ConnectionsReader {
  return {
    isReady: () => Boolean(plugin.ready),
    isEmbedReady: () => Boolean(plugin.embed_ready),
    getStatusState: () => plugin.status_state ?? '',
    hasPendingReImport: (p) => plugin.pendingReImportPaths?.has(p) ?? false,
    getBlocksForSource: (p) => plugin.block_collection?.for_source(p) ?? [],
    getSource: (p) => plugin.source_collection?.get(p) ?? null,
    getEmbedRuntimeState: () => plugin.getEmbedRuntimeState?.() ?? null,
    getSearchModelFingerprint: () => plugin._search_embed_model?.fingerprint ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/connections-reader-adapter.test.ts && pnpm run typecheck && pnpm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/connections-reader-adapter.ts test/connections-reader-adapter.test.ts
git commit -m "feat(ui): ConnectionsReader adapter at composition root"
```

### Task A.3: Reroute `deriveConnectionsViewState` through the Reader

**Files:**
- Modify: `open-connections/src/ui/connections-view-state.ts:21-70` (replace `view.plugin.*` reads; keep writes untouched)
- Test: `open-connections/test/connections-view-state.reader-injection.test.ts` (new)

> The write-side calls (`import_source_blocks`, `data_adapter.save`, `autoQueueBlockEmbedding`) stay on `view.plugin.*` in this task. They will leave the view in Slice 2.

- [ ] **Step 1: Write the failing test**

```ts
// test/connections-view-state.reader-injection.test.ts
import { describe, it, expect } from 'vitest';
import { deriveConnectionsViewState } from '../src/ui/connections-view-state';
import type { ConnectionsReader } from '../src/types/connections-reader';

function makeReader(overrides: Partial<ConnectionsReader> = {}): ConnectionsReader {
  return {
    isReady: () => true, isEmbedReady: () => true, getStatusState: () => 'ok',
    hasPendingReImport: () => false,
    getBlocksForSource: () => [],
    getSource: () => null,
    getEmbedRuntimeState: () => null,
    getSearchModelFingerprint: () => 'fp-1',
    ...overrides,
  };
}

describe('deriveConnectionsViewState — reader-driven reads', () => {
  it('returns plugin_loading when reader.isReady() is false', async () => {
    const view: any = { plugin: { block_collection: {} }, reader: makeReader({ isReady: () => false }) };
    const state = await deriveConnectionsViewState(view, 'a.md');
    expect(state.type).toBe('plugin_loading');
  });

  it('returns pending_import when reader reports pending', async () => {
    const view: any = { plugin: { block_collection: { for_source: () => [] } }, reader: makeReader({ hasPendingReImport: () => true }) };
    const state = await deriveConnectionsViewState(view, 'a.md');
    expect(state).toEqual({ type: 'pending_import', path: 'a.md' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/connections-view-state.reader-injection.test.ts`
Expected: FAIL — `view.reader` is undefined; function still reads `view.plugin.ready`.

- [ ] **Step 3: Modify `deriveConnectionsViewState` minimally**

Only swap the READ paths to `view.reader.*`. Keep `view.plugin.block_collection.import_source_blocks(...)` and `view.plugin.block_collection.data_adapter.save()` lines exactly as-is (Slice 2 work).

`view.plugin.block_collection` is **not** allowed to remain in the steady-state render path just because the write-side calls are temporarily preserved here. In particular, `getBlockConnections(view.plugin.block_collection, ...)` must be eliminated behind a read/query seam before Slice 1 sign-off, because the spec's Success Criterion 1 forbids passing `view.plugin.block_collection` through the render path.

```ts
// src/ui/connections-view-state.ts (excerpt)
export async function deriveConnectionsViewState(view: ConnectionsView, targetPath: string): Promise<ViewState> {
  const r = view.reader;
  if (!r.isReady()) return { type: 'plugin_loading' };

  let allFileBlocks = r.getBlocksForSource(targetPath);
  if (allFileBlocks.length === 0) {
    if (r.hasPendingReImport(targetPath)) return { type: 'pending_import', path: targetPath };
    const source = r.getSource(targetPath);
    if (source) {
      // writes stay on plugin for Slice 1 — Slice 2 will extract
      await view.plugin.block_collection.import_source_blocks(source);
      await view.plugin.block_collection.data_adapter.save();
      allFileBlocks = r.getBlocksForSource(targetPath);
    }
    if (allFileBlocks.length === 0) return { type: 'note_too_short' };
  }
  /* ...remaining branches use r.getEmbedRuntimeState(), r.getStatusState(), r.isEmbedReady()... */
}
```

- [ ] **Step 4: Run all tests**

Run: `pnpm run typecheck && pnpm run lint && pnpm vitest run`
Expected: all green, including the older `connections-view-state.test.ts` (may require injecting a reader into its fixture — fix the fixture, don't weaken the test).

- [ ] **Step 5: Commit**

```bash
git add src/ui/connections-view-state.ts test/connections-view-state.reader-injection.test.ts test/**/*.ts
git commit -m "refactor(ui): route deriveConnectionsViewState reads through ConnectionsReader"
```

### Task A.4: Inject Reader into `ConnectionsView` and wire `main.ts`

**Files:**
- Modify: `open-connections/src/ui/ConnectionsView.ts:33-53` (constructor + field)
- Modify: `open-connections/src/main.ts` (registerView factory)
- Test: `open-connections/test/connections-view.wiring.test.ts` (new, tiny)

- [ ] **Step 1: Write the failing test**

```ts
// test/connections-view.wiring.test.ts
import { describe, it, expect } from 'vitest';
import { ConnectionsView } from '../src/ui/ConnectionsView';

describe('ConnectionsView constructor wiring', () => {
  it('accepts a ConnectionsReader and exposes it as view.reader', () => {
    const leaf: any = { view: null }; const plugin: any = { ready: true };
    const reader: any = { isReady: () => true };
    const view = new ConnectionsView(leaf, plugin, reader);
    expect((view as any).reader).toBe(reader);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/connections-view.wiring.test.ts`
Expected: FAIL — constructor takes 2 args.

- [ ] **Step 3: Modify ConnectionsView and main.ts**

```ts
// src/ui/ConnectionsView.ts (excerpt)
constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin, reader: ConnectionsReader) {
  super(leaf); this.plugin = plugin; this.reader = reader; this.navigation = false; loadConnectionsSession(this);
}
// ...
reader: ConnectionsReader;
```

```ts
// src/main.ts (excerpt where registerView is called)
this.registerView(CONNECTIONS_VIEW_TYPE, (leaf) => new ConnectionsView(leaf, this, createConnectionsReader(this)));
```

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ConnectionsView.ts src/main.ts test/connections-view.wiring.test.ts
git commit -m "feat(ui): inject ConnectionsReader into ConnectionsView via constructor"
```

### Task A.5: Phase-A review gate

- [ ] **Step 1: Dispatch `code-reviewer` subagent**

```
Agent(subagent_type="oh-my-claudecode:code-reviewer",
  description="Phase A seam review",
  prompt="Review commits from 'add ConnectionsReader port' through 'inject ConnectionsReader'. Check: (1) src/types/connections-reader.ts has zero obsidian imports; (2) ConnectionsView constructor signature change is honored at every call site; (3) tests stub the reader and do NOT stub the whole plugin; (4) no write-side calls were moved; (5) rules.md R3/R4 respected per file. Report pass/fail with specific file:line evidence."
)
```

- [ ] **Step 2: Resolve findings, then tag**

If review passes: `git tag slice-1-phase-a-done` (local tag only, do NOT push).

---

## Phase B — Characterization Tests (capture existing render behavior)

> Goal: before we alter render logic in Phase C/D, lock down today's observable behavior with tests that run against the new Reader-injected view. Each test below runs the view's existing `renderView(path)` and asserts on DOM + event state.

### Task B.1: Characterize each `ViewState` branch

**Files:**
- Test: `open-connections/test/connections-view.characterization.test.ts`

- [ ] **Step 1: Write the failing characterization suite (one `it` per ViewState variant)**

```ts
// test/connections-view.characterization.test.ts (excerpt — pattern repeats for each variant)
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionsView } from '../src/ui/ConnectionsView';
import type { ConnectionsReader } from '../src/types/connections-reader';

function mountView(reader: ConnectionsReader, plugin: any = {}) {
  const leaf: any = { view: null, containerEl: document.createElement('div') };
  leaf.containerEl.appendChild(document.createElement('div'));
  leaf.containerEl.appendChild(document.createElement('div'));
  const view = new ConnectionsView(leaf, plugin, reader);
  (view as any).container = leaf.containerEl.children[1];
  return view;
}

describe('ConnectionsView characterization', () => {
  beforeEach(() => { /* reset jsdom */ });

  it('shows note_too_short empty message when no blocks and no source', async () => {
    const reader = /* …stub that returns [] for getBlocksForSource and null for getSource… */;
    const view = mountView(reader);
    await view.renderView('a.md');
    expect((view as any).container.textContent).toMatch(/too short/i);
  });

  it('shows loading when reader.isEmbedReady() is false and no blocks embedded', async () => { /* … */ });
  it('renders results container when reader yields embedded blocks', async () => { /* … */ });
  it('shows pending_import loading when reader.hasPendingReImport() is true', async () => { /* … */ });
  it('shows model_error when getStatusState is "error"', async () => { /* … */ });
});
```

- [ ] **Step 2: Run to verify characterization passes on current behavior**

Run: `pnpm vitest run test/connections-view.characterization.test.ts`
Expected: PASS. If any fail, the reader wiring from Phase A is wrong — STOP and fix Phase A before continuing.

- [ ] **Step 3: Commit characterization baseline**

```bash
git add test/connections-view.characterization.test.ts
git commit -m "test(ui): characterize ConnectionsView render branches (pre-SWR baseline)"
```

### Task B.2: Phase-B review gate

- [ ] **Step 1: Dispatch `verifier` subagent**

```
Agent(subagent_type="oh-my-claudecode:verifier",
  description="Phase B characterization coverage",
  prompt="Run `pnpm vitest run test/connections-view.characterization.test.ts --coverage` and verify every ViewState variant in src/ui/connections-view-state.ts is exercised. Report any variant missing a test with file:line of the missing branch."
)
```

---

## Phase C — Pure `ConnectionsResultCache` (TDD)

### Task C.1: `get` / `set` exact-match semantics

**Files:**
- Create: `open-connections/src/domain/connections/result-cache.ts`
- Test: `open-connections/test/connections-result-cache.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/connections-result-cache.test.ts
import { describe, it, expect } from 'vitest';
import { ConnectionsResultCache } from '../src/domain/connections/result-cache';

describe('ConnectionsResultCache', () => {
  it('returns null for a cold miss', () => {
    const c = new ConnectionsResultCache();
    expect(c.get('a.md', 'fp-1')).toBeNull();
  });

  it('returns stored results on exact (path, fingerprint) hit', () => {
    const c = new ConnectionsResultCache();
    const results = [{ key: 'b1', score: 0.9 }] as any;
    c.set('a.md', 'fp-1', results);
    expect(c.get('a.md', 'fp-1')).toEqual(results);
  });

  it('treats fingerprint mismatch as a miss', () => {
    const c = new ConnectionsResultCache();
    c.set('a.md', 'fp-1', [{ key: 'b1' }] as any);
    expect(c.get('a.md', 'fp-2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm vitest run test/connections-result-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation**

```ts
// src/domain/connections/result-cache.ts
import type { ConnectionResult } from '../../types/entities';

export class ConnectionsResultCache {
  private readonly store = new Map<string, { fingerprint: string; results: readonly ConnectionResult[] }>();
  get(path: string, fingerprint: string): readonly ConnectionResult[] | null {
    const entry = this.store.get(path);
    return entry && entry.fingerprint === fingerprint ? entry.results : null;
  }
  set(path: string, fingerprint: string, results: readonly ConnectionResult[]): void {
    this.store.set(path, { fingerprint, results });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/connections-result-cache.test.ts && pnpm run typecheck && pnpm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/connections/result-cache.ts test/connections-result-cache.test.ts
git commit -m "feat(domain): ConnectionsResultCache exact-match get/set"
```

### Task C.2: `invalidate(path)` and `invalidateAll()`

- [ ] **Step 1: Write failing test**

```ts
// (append to test/connections-result-cache.test.ts)
it('invalidate(path) removes only that path', () => {
  const c = new ConnectionsResultCache();
  c.set('a.md', 'fp', [{}] as any); c.set('b.md', 'fp', [{}] as any);
  c.invalidate('a.md');
  expect(c.get('a.md', 'fp')).toBeNull();
  expect(c.get('b.md', 'fp')).not.toBeNull();
});

it('invalidateAll() clears everything', () => {
  const c = new ConnectionsResultCache();
  c.set('a.md', 'fp', [{}] as any); c.set('b.md', 'fp', [{}] as any);
  c.invalidateAll();
  expect(c.get('a.md', 'fp')).toBeNull();
  expect(c.get('b.md', 'fp')).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail**; **Step 3: Add methods**; **Step 4: Run to verify pass**; **Step 5: Commit**

```ts
invalidate(path: string): void { this.store.delete(path); }
invalidateAll(): void { this.store.clear(); }
```

```bash
git commit -m "feat(domain): ConnectionsResultCache invalidate(path) + invalidateAll()"
```

### Task C.3: LRU bound (per OQ-5 default `max=64`)

- [ ] **Step 1: Failing test**

```ts
it('evicts the least-recently-used entry when over max', () => {
  const c = new ConnectionsResultCache(2); // tiny bound for test
  c.set('a.md', 'fp', [{}] as any);
  c.set('b.md', 'fp', [{}] as any);
  c.get('a.md', 'fp'); // bumps a
  c.set('c.md', 'fp', [{}] as any); // should evict b
  expect(c.get('b.md', 'fp')).toBeNull();
  expect(c.get('a.md', 'fp')).not.toBeNull();
  expect(c.get('c.md', 'fp')).not.toBeNull();
});
```

- [ ] **Step 2-4: Implement LRU semantics using Map insertion-order + re-insert on hit**; **Step 5: Commit**

```bash
git commit -m "feat(domain): ConnectionsResultCache LRU bound (default 64)"
```

---

## Phase D — Pure `decideRender` + SWR Orchestration (TDD)

### Task D.1: `decideRender` pure decision function

**Files:**
- Create: `open-connections/src/domain/connections/render-orchestration.ts`
- Test: `open-connections/test/connections-render-orchestration.test.ts`

- [ ] **Step 1: Failing test (one case per decision branch)**

```ts
describe('decideRender', () => {
  it('compute_fresh on cold cache, phase idle', () => { /* expect 'compute_fresh' */ });
  it('serve_cached on hit, same fingerprint, phase idle', () => { /* expect 'serve_cached' */ });
  it('revalidate_in_background on hit, same fingerprint, phase running', () => { /* expect 'revalidate_in_background' with staleResults */ });
  it('compute_fresh on fingerprint mismatch even when entry exists', () => { /* expect 'compute_fresh' */ });
  it('compute_fresh on phase error', () => { /* still recompute so user sees a fresh attempt */ });
});
```

- [ ] **Steps 2-4: Minimal implementation + green tests**
- [ ] **Step 5: Commit** — `feat(domain): decideRender — serve-cached vs. compute vs. revalidate`

### Task D.2: Wire cache + decideRender into `ConnectionsView.renderView`

**Files:**
- Modify: `open-connections/src/ui/ConnectionsView.ts:114-end` (`renderView`)
- Modify: `open-connections/src/ui/connections-view-results.ts` (support "apply cached results without container.empty()")
- Test: `open-connections/test/connections-view-swr.integration.test.ts`

- [ ] **Step 1: Failing integration test — same (path, fingerprint) re-entry skips container.empty()**

```ts
it('does not call container.empty() on identical re-render', async () => {
  const { view, container } = mountWithCache(/* seeds cache: 'a.md'@fp-1 → [r1] */);
  const emptySpy = vi.spyOn(container, 'empty');
  await view.renderView('a.md'); // first render: fills from cache or compute
  const before = emptySpy.mock.calls.length;
  await view.renderView('a.md'); // re-entry: must not empty()
  expect(emptySpy.mock.calls.length).toBe(before);
});
```

- [ ] **Step 2: Failing integration test — fingerprint change invalidates and re-renders**

```ts
it('on fingerprint change invalidates cache and shows loading then new results', async () => { /* … */ });
```

- [ ] **Step 3: Failing integration test — running→idle transition revalidates exactly once**

> Requires `Workspace.trigger()` seam — if the seam is missing, this test will silently no-op. Phase E adds it; this task either (a) waits on Phase E or (b) includes a local `trigger()` stub and migrates to the shared mock in Phase E.

```ts
it('revalidates on embed-state-changed: running→idle', async () => {
  const { view, workspace, readerSetResults } = mountWithCache();
  await view.renderView('a.md');
  readerSetResults('a.md', [{ key: 'new' }]);
  workspace.trigger('open-connections:embed-state-changed', { prev: 'running', phase: 'idle' });
  await flushMicro();
  expect(/* rendered results now include 'new' */).toBe(true);
});
```

- [ ] **Steps 4-6: Minimal impl — renderView consults cache via decideRender; compute path fills cache; event handler invalidates path entry on running→idle**
- [ ] **Step 7: Run full CI**
- [ ] **Step 8: Commit** — `feat(ui): stale-while-revalidate Connections results pipeline`

### Task D.3: Fingerprint source of truth — plumb through Reader

- [ ] **Step 1: Failing test** — view uses `reader.getSearchModelFingerprint()` as the cache key; null fingerprint ⇒ always compute
- [ ] **Steps 2-4: Impl**; **Step 5: Commit** — `feat(ui): use Reader fingerprint for SWR cache key`

### Task D.4: Phase-D review gate

- [ ] **Step 1: Dispatch `critic` subagent**

```
Agent(subagent_type="oh-my-claudecode:critic",
  description="Phase D SWR correctness review",
  prompt="Read render-orchestration.ts, ConnectionsView.renderView, and the SWR integration tests. Adversarially check: (1) does container.empty() truly skip on hit? (2) is revalidation idempotent under rapid-fire events? (3) does fingerprint=null correctly force compute_fresh? (4) any race between two concurrent renderView calls (check _renderGen interaction)? Report concrete counter-examples or sign off."
)
```

- [ ] **Step 2: Resolve findings; tag `slice-1-phase-d-done` locally.**

---

## Phase E — Test Infrastructure Seam (shared Workspace.trigger mock)

### Task E.1: Add `trigger(name, payload)` to `test/mocks/obsidian.ts`

**Files:**
- Modify: `open-connections/test/mocks/obsidian.ts`
- Test: `open-connections/test/mocks/obsidian.trigger.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { Workspace } from './obsidian';

describe('Workspace mock trigger', () => {
  it('invokes handlers registered via on()', () => {
    const w = new Workspace(); const h = vi.fn();
    w.on('file-open', h);
    w.trigger('file-open', { path: 'a.md' });
    expect(h).toHaveBeenCalledWith({ path: 'a.md' });
  });

  it('returns the registered event ref for unregistration', () => {
    const w = new Workspace(); const h = vi.fn();
    const ref = w.on('x', h); w.offref(ref);
    w.trigger('x'); expect(h).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**; **Step 3: Extend mock to maintain a `Map<string, Set<Handler>>` and implement `trigger` / `offref`**; **Step 4: Run all existing tests to ensure no regressions**; **Step 5: Commit**

```bash
git commit -m "test(mocks): add Workspace.trigger/offref to obsidian mock"
```

### Task E.2: Migrate Phase-D SWR tests to use shared trigger mock

- [ ] **Step 1: Replace any local trigger stub with import from `./mocks/obsidian`**; **Step 2: Full CI**; **Step 3: Commit** — `test: migrate SWR tests to shared trigger mock`

### Task E.3: Final review + verifier

- [ ] **Step 1: `code-reviewer` subagent over the full diff from Phase A start**
- [ ] **Step 2: `verifier` subagent runs `pnpm run ci`, confirms coverage floor, and inspects each Success Criterion in the spec**
- [ ] **Step 3: On sign-off, tag `slice-1-done` locally**

---

## Self-Review Checklist (run by the planner before handoff)

- [ ] Every spec Success Criterion maps to at least one task above.
- [ ] No placeholder strings (no "TBD", no "implement error handling").
- [ ] File paths exist or are explicitly `Create` with rationale.
- [ ] Commit messages follow the repo's conventional style (seen in `git log`).
- [ ] Each task is ≤ 5 files touched.
- [ ] TDD cadence: test first, verify fail, minimal impl, verify pass, commit — every task.
- [ ] Any broadened cleanup is justified in the task notes as freeze-causal or test-enabling.
- [ ] Any deferred spec item is explicitly documented with the behavior-risk / non-causal evidence that justified deferral.
- [ ] No end-state production path still passes `view.plugin.block_collection` into render-time reads or result fetching.
- [ ] ESLint layer walls are not violated (no `obsidian` in `src/types/` or `src/domain/`).
- [ ] Writes (`import_source_blocks`, `data_adapter.save`, `autoQueueBlockEmbedding`) are untouched in Slice 1.

---

## Execution Handoff

**Plan complete.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks. Invoke via `superpowers:subagent-driven-development`.
2. **Inline Execution** — Execute tasks in this session with checkpoints. Invoke via `superpowers:executing-plans`.

Which approach?
