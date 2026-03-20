# Open Smart Connections — Ralph Loop Prompt

## Mission

Transform Open Smart Connections into a stable, polished Obsidian plugin that provides the same note-connection experience as Smart Connections v3.0.80, but with:
1. **SQLite-based storage** (replacing PGlite) for stability
2. **Upstage Solar** as the preferred embedding model (Korean-optimized)
3. **Polished, modern UI** following CRAP design principles
4. **Feature parity** with upstream SC v3 core features

## Working Directory

```
/Users/beomsu/Documents/Dev/Obsidian-Plugins/obsidian-smart-connections/
```

## Progress Tracking

At the START of every iteration:
1. Read `PROGRESS.md` — find the current phase and step
2. If `PROGRESS.md` doesn't exist, create it and start Phase 1 Step 1

At the END of every iteration:
1. Update `PROGRESS.md` with what was completed and what's next
2. Run the verification protocol

## Architecture Context

Current codebase (v3.2.2):
- `src/app/main.ts` — Plugin entry point (SmartConnectionsPlugin)
- `src/features/embedding/` — Embedding kernel (Redux-style: store/reducer/effects)
- `src/features/connections/ConnectionsView.ts` — Related notes panel
- `src/features/lookup/LookupView.ts` — Semantic search panel
- `src/shared/entities/` — Entity model (Source, Block, Collection)
- `src/shared/entities/adapters/pglite-data-adapter.ts` — **REPLACE THIS**
- `src/shared/models/embed/adapters/` — 7 embedding adapters (keep all)
- `src/shared/search/` — Vector search, cosine similarity
- `worker/embed-worker.ts` — Transformers.js Web Worker
- `src/styles.css` — Plugin CSS

## Phases

### Phase 1: Storage Migration (PGlite → sql.js SQLite)

**Goal:** Replace PGlite with sql.js for all entity storage. This is the core stability improvement.

**Steps:**

1.1. Add `sql.js` as dependency, remove `@electric-sql/pglite` from package.json
1.2. Create `src/shared/entities/adapters/sqlite-data-adapter.ts`:
   - SQLite schema:
     ```sql
     CREATE TABLE IF NOT EXISTS entities (
       key TEXT PRIMARY KEY,
       collection TEXT NOT NULL,
       data TEXT NOT NULL,
       vec BLOB,
       hash TEXT,
       mtime INTEGER
     );
     CREATE INDEX IF NOT EXISTS idx_entities_collection ON entities(collection);
     CREATE INDEX IF NOT EXISTS idx_entities_hash ON entities(hash);
     ```
   - Store vectors: `Float32Array` → `Buffer` → BLOB
   - Read vectors: BLOB → `Buffer` → `Float32Array`
   - Implement the same interface as `pglite-data-adapter.ts`
   - DB file location: plugin data directory (`this.app.vault.configDir + '/plugins/open-smart-connections/embeddings.db'`)
   - Persist: call `db.export()` and write to file periodically + on unload
   - Load: read file on init, pass to `new SQL.Database(data)`
1.3. Update `EntityCollection`, `SourceCollection`, `BlockCollection` to use new SQLite adapter
1.4. Update `collection-manager.ts` to initialize SQLite instead of PGlite
1.5. Update `src/app/main.ts` — remove PGlite init, add SQLite lifecycle
1.6. Remove ALL PGlite references (imports, types, config)
1.7. Update tests to work with SQLite adapter
1.8. Cosine similarity stays in JS (`src/shared/utils/cos_sim.ts`) — no change needed

**Exit criteria:**
- `pnpm build` succeeds with zero errors
- `pnpm lint` passes
- `pnpm test` passes
- No `pglite` imports remain anywhere in codebase
- Use `/obsidian-cli` to verify: plugin loads, no console errors

### Phase 2: Upstage Solar as Recommended Embedding

**Goal:** Make Solar the recommended API embedding model with query/passage intelligence.

**Steps:**

2.1. Update `src/shared/models/embed/adapters/upstage.ts`:
   - Increase `batch_size` to 100 (API supports it)
   - Add rate limiting: max 100 requests/minute
   - Document the query/passage split clearly
2.2. Implement smart model switching in search flow:
   - When INDEXING documents: use `embedding-passage`
   - When SEARCHING (lookup/connections query): use `embedding-query`
   - Both share the same 4096-dim vector space — direct comparison works
   - This switching should be transparent to the user
2.3. Update `src/app/config.ts` DEFAULT_SETTINGS:
   - Keep default local model (bge-micro-v2) for zero-setup experience
   - Add Solar as highlighted recommended option in settings UI
2.4. Update `src/app/settings.ts` and `settings-model-picker.ts`:
   - Show Solar recommendation badge for Korean/multilingual users
   - API key input for Upstage

**Exit criteria:**
- Build + lint + test pass
- Use `/obsidian-cli` to verify:
  - Configure Upstage API key in settings
  - Trigger embedding — notes get embedded with Solar
  - Search returns semantically relevant results
  - Connections view shows related notes with scores

### Phase 3: UI Polish

**Goal:** Refined, modern UI that matches or exceeds Smart Connections v3 quality. Follow CRAP design principles (Contrast, Repetition, Alignment, Proximity).

**Steps:**

3.1. ConnectionsView improvements (`src/features/connections/ConnectionsView.ts`):
   - Score as percentage badge with tier coloring: high (≥85% green), medium (≥70% yellow), low (gray)
   - Hover preview using Obsidian's native `app.workspace.trigger('hover-link', ...)`
   - Keyboard navigation: arrow up/down to move, Enter to open
   - Pin connections (persist in plugin data, show pinned items at top)
   - Hide connections (persist, filter from results)
   - Pause/Play toggle — freeze the connections list while navigating between notes
3.2. LookupView improvements (`src/features/lookup/LookupView.ts`):
   - Clean search input with clear button
   - Filter tabs: All / Notes / Blocks
   - Result items with path breadcrumbs, score badge, hover preview
   - Drag support for results (drag into editor to create link)
3.3. Styles (`src/styles.css`):
   - Use Obsidian CSS variables exclusively (no hardcoded colors)
   - Minimize custom CSS — leverage native Obsidian classes
   - Remove unused CSS rules
   - Ensure dark/light theme consistency
3.4. Result context menu (`src/views/result-context-menu.ts`):
   - Open in new tab / split
   - Copy as wikilink
   - Pin/Hide from connections

**Exit criteria:**
- Build + lint + test pass
- Use `/obsidian-cli` to verify:
  - Take screenshot of connections view → visually polished
  - Hover preview shows note content on hover
  - Keyboard nav works (up/down/enter)
  - Pin a connection → persists after reload
  - Pause connections → stays frozen when switching notes

### Phase 4: Feature Parity with SC v3

**Goal:** Key SC v3.0.80 features that enhance the connection experience.

**Steps:**

4.1. **Smart Context command**: Copy all current connections as formatted markdown to clipboard
   - Format: `- [[Note Title]] (85%) — first line of content`
   - Register as command palette action
4.2. **`smart-connections` codeblock**: Embed connections inline in notes
   - Syntax: ` ```smart-connections\npath: current\nlimit: 5\n``` `
   - Renders a mini connections list within the note
   - Uses Obsidian's `registerMarkdownCodeBlockProcessor`
4.3. **Block-level delta re-embedding**: Only re-embed blocks that changed
   - Track content hash per block
   - On file change: reparse blocks, compare hashes
   - Only queue changed blocks for embedding
   - This is a major performance optimization for large vaults
4.4. **Context selector**: Filter connections by folder or tag
   - Dropdown/modal in ConnectionsView header
   - Filter options: folder path, tag, file type

**Exit criteria:**
- Build + lint + test pass
- Use `/obsidian-cli` to verify:
  - Smart Context command copies connections to clipboard
  - Codeblock renders connections inline when viewing note
  - Edit a note → only changed blocks re-embed (check embedding count)
  - Context selector filters connections by folder

## Verification Protocol

Run after EVERY iteration, regardless of phase:

```bash
# 1. Build
cd /Users/beomsu/Documents/Dev/Obsidian-Plugins/obsidian-smart-connections
pnpm build

# 2. Lint (fix if needed)
pnpm lint:fix

# 3. Test (fix failures)
pnpm test
```

Then use the `/obsidian-cli` skill to:
1. Copy built plugin to test vault
2. Reload the plugin
3. Check for console errors
4. Verify the current phase's functionality works in real Obsidian

**Important:** If build/lint/test fails, fix it before moving on. Do NOT skip verification.

## Constraints

- Keep ALL 7 embedding adapters (Transformers.js, OpenAI, Ollama, Gemini, LM Studio, Upstage, OpenRouter)
- Maintain existing test coverage — add tests for new code
- Follow existing code conventions (feature-first architecture, Redux-style kernel)
- Plugin is desktop-only (`isDesktopOnly: true`)
- No jsbrains dependency
- GPL-3.0 license
- Branch: create `feature/sqlite-solar-ui` from `main` before starting work
- Commit after each completed step with descriptive message

## Completion

When ALL four phases pass ALL verification criteria and the plugin works end-to-end:
- Notes embed successfully (SQLite stores vectors)
- Search returns relevant results
- Connections view shows related notes with polished UI
- All v3 parity features work

Output this EXACTLY:

<promise>OPEN SMART CONNECTIONS COMPLETE</promise>
