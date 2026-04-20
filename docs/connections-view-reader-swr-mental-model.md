# Connections View Reader + SWR Mental Model

## Why this exists
This note captures the mental model behind the Slice 1 Connections View refactor so future changes keep the freeze-fix intent intact instead of slowly reintroducing main-thread coupling.

## Primary goal
Reduce note-switch UI freezes **without** breaking the existing Connections View behavior.

The key decision rule for this work was:

> Prefer freeze reduction and behavior preservation over spec completeness when those goals conflict.

## The model in one sentence
The Connections View should **read through one seam, show stale results immediately when they are still trustworthy, and only recompute when trust is broken**.

## 1. Read path vs write path
The first mental split is **query vs command**.

- **Read path**: determine what the view should show right now.
- **Write path**: import blocks, save derived state, queue embeddings, and mutate caches.

The problem before Slice 1 was that the render flow mixed these together. A "what should I show?" call could also trigger import/save work and pull plugin internals directly into the view.

The Slice 1 seam fixes that by making the view ask a `ConnectionsReader` for read-side information instead of reaching into plugin state ad hoc.

## 2. One seam for render-time reads
`ConnectionsReader` is the render-time contract.

The view/state path should not ask:
- which plugin field currently holds the blocks
- how embed runtime state is shaped
- how on-demand block hydration happens
- how connection results are queried

It should ask the reader.

That gives us two benefits:
1. render logic becomes unit-testable with plain stubs
2. coupling is concentrated in one adapter instead of spreading through the UI

## 3. Trust model for cached results
The cache is not "show old data forever".
It is a **trust model**.

Cached results are safe to reuse only when the tuple below still matches reality:
- same note path
- same embedding fingerprint
- no pending re-import for that note
- no lifecycle event that invalidates the previous result

If those conditions hold, the fastest and safest UX is:
- show cached results immediately
- avoid blanking the panel
- revalidate only when needed

## 4. When stale-while-revalidate is correct
SWR is correct when the user is looking at the **same semantic context**.

That means:
- reopening the same note with the same fingerprint should reuse results
- the panel should not flash `loading -> results` again
- background work may continue, but the visible panel should stay stable

This is why the view-level cache sits in front of the expensive query path.

## 5. What breaks trust and forces recompute
There are three important invalidators.

### A. Fingerprint change
If the embedding fingerprint changes, previous results were computed under a different semantic basis.

Action:
- invalidate all cached connection results
- show the model-change loading banner
- recompute fresh results

### B. Pending re-import
If a path is pending re-import, cached results may already be stale for that note.

Action:
- bypass/invalidate the cached entry for that path
- show pending/import/embedding states instead of stale results

### C. `running -> idle`
When embed state transitions from `running` to `idle`, background work has just settled.

Action:
- invalidate the path cache
- trigger exactly one re-render
- let the view refresh to the newly trustworthy result set

## 6. Why the cache lives in the view layer
The cache is tied to **render behavior**, not durable data ownership.

It answers a UI question:
- "Can I safely show what I showed a moment ago?"

That makes it a better fit for the view/UI boundary than for global persisted state.

## 7. Why pure orchestration matters
`decideRender()` exists so the policy stays explicit and testable.

Instead of encoding cache behavior implicitly across conditionals in the view, we keep the decision table pure:
- cache miss -> compute fresh
- cache hit + idle -> serve cached
- cache hit + running -> revalidate in background

This makes regressions easier to catch and keeps future changes honest.

## 8. What future maintainers should preserve
If you change this area later, preserve these invariants:

1. **Render reads go through `ConnectionsReader`**
2. **Do not blank the panel on safe same-note re-entry**
3. **Do not reuse cached results when trust is broken**
4. **Keep cache/orchestration logic testable in isolation**
5. **Prefer user-visible stability over speculative eager recompute**

## 9. Smell checklist
If any of these reappear, the design is drifting:

- `ConnectionsView` reaches directly into plugin internals for read decisions
- render logic reintroduces ad hoc cache policy
- same-note re-entry flashes loading again
- pending re-import can still show stale cached results
- embed lifecycle events trigger duplicate or missing refreshes

## 10. Short version
This refactor was guided by a simple idea:

> The Connections View should behave like a stable reader of current truth, not a place where reading and mutation are entangled.

That is the reason the reader seam, SWR cache, fingerprint invalidation, pending-reimport bypass, and running-to-idle revalidation all belong together.
