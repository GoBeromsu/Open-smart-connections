# Open Smart Connections — Ralph Loop Progress

## Current Phase: 4 (Feature Parity) — In Progress
## Current Step: 4.3 next (block-level delta re-embedding)

### Phase 1: Storage Migration (PGlite → sql.js SQLite) — COMPLETE
- [x] 1.1 Add sql.js dependency, remove @electric-sql/pglite
- [x] 1.2 Create sqlite-data-adapter.ts
- [x] 1.3 Update EntityCollection to use SqliteDataAdapter
- [x] 1.4 Update collection-manager.ts (vault context injection)
- [x] 1.5 Update main.ts (SQLite lifecycle: closeSqliteDatabases on unload)
- [x] 1.6 Remove PGlite references from barrel exports
- [x] 1.7 Tests pass (no changes needed)
- [x] 1.8 Runtime verified (plugin loads, embedding FSM active, no errors)

### Phase 2: Upstage Solar Embedding — COMPLETE
- [x] 2.1 Update Upstage adapter (batch_size 50, Korean-optimized descriptions)
- [x] 2.2 Implement query/passage model switching (embed_query method)
- [x] 2.3 Updated model type interface
- [x] 2.4 lookup.ts uses embed_query for search

### Phase 3: UI Polish — COMPLETE
- [x] 3.1 ConnectionsView: percentage scores, path breadcrumbs, pause/play, pin/hide
- [x] 3.2 Context menu: pin/unpin, hide connection
- [x] 3.3 Styles: focus-visible, pinned border, breadcrumb, active button
- [x] 3.4 Session state persisted in settings

### Phase 4: Feature Parity with SC v3 — IN PROGRESS
- [x] 4.1 Smart Context command (copy connections as markdown)
- [x] 4.2 smart-connections codeblock processor
- [ ] 4.3 Block-level delta re-embedding
- [ ] 4.4 Context selector (filter by folder/tag)
- [x] Random Connection command (bonus)

### Verification Status
- Build: PASS (349.2KB bundle)
- Lint: PASS (0 errors)
- Test: PASS (17 files, 221 tests)
- Runtime: PASS (no errors, commands registered, FSM running)
- Commands registered: 8 total (including 2 new)
