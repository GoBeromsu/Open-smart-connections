<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# domain/entities

## Purpose
Data model layer for the embedding system. Defines the entity classes (`EmbeddingSource`, `EmbeddingBlock`), collection types (`SourceCollection`, `BlockCollection`, `EntityCollection`), SQLite persistence adapter, and markdown block splitter. No `obsidian` imports — uses shim interfaces from `src/types/`.

## Key Files

| File | Description |
|------|-------------|
| `EmbeddingEntity.ts` | Abstract base class — key, vector, metadata, dirty flag |
| `EmbeddingSource.ts` | Source entity (a whole note) — extends EmbeddingEntity |
| `EmbeddingBlock.ts` | Block entity (a paragraph/section) — extends EmbeddingEntity |
| `EntityCollection.ts` | Generic collection: CRUD, nearest-neighbor search, LRU cache |
| `SourceCollection.ts` | Source-specific collection — extends EntityCollection |
| `BlockCollection.ts` | Block-specific collection — extends EntityCollection |
| `node-sqlite-data-adapter.ts` | `node:sqlite` persistence adapter (Electron 39.5.1 / Node 22+) |
| `markdown-splitter.ts` | Splits markdown into embedding blocks (paragraphs/sections) |
| `index.ts` | Barrel export |

## For AI Agents

### Working In This Directory
- **No `obsidian` imports** — use shim interfaces from `src/types/obsidian-shims.ts` (structural typing)
- `EntityCollection.all` returns `T[]` — never cast to `any[]`
- SQLite adapter uses `node:sqlite` (built-in Node.js) — NOT `better-sqlite3`
- `markdown-splitter.ts` is pure: `(text: string) → Block[]` — no I/O

### Testing Requirements
Tests in `test/entities.test.ts`, `test/node-sqlite-data-adapter.test.ts` (sqlite-integration suite), `test/block-collection-index.test.ts`

### Common Patterns
```typescript
// Correct — .all is already typed T[]
const blocks = this.block_collection.all; // EmbeddingBlock[]

// nearest-neighbor search
const results = await collection.nearest(queryVec, { limit: 10 });
```

## Dependencies
- `src/types/obsidian-shims.ts` — FileRef, NoteMetadata shim interfaces
