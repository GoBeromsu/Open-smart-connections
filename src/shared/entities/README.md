# Entity Framework

This directory contains the refactored entity framework with MetadataCache integration.

## Overview

The entity framework provides a TypeScript-based, MetadataCache-driven system for managing file sources and content blocks with embeddings. It replaces the legacy SmartSources/SmartBlocks system while maintaining full AJSON cache compatibility.

## Architecture

### Core Classes

1. **EmbeddingEntity** (`EmbeddingEntity.ts`)
   - Base entity class with embedding support
   - Manages embedding vectors, hashing, and lifecycle
   - Ported from `lib/entities/smart_entity.js`

2. **EmbeddingSource** (`EmbeddingSource.ts`)
   - Source (file) entity
   - Uses `vault.cachedRead()` for content access
   - Integrates with MetadataCache for file metadata
   - Ported from `lib/entities/sources/smart_source.js`

3. **EmbeddingBlock** (`EmbeddingBlock.ts`)
   - Block (section) entity
   - Uses MetadataCache sections for heading-based blocks
   - Key format: `path#heading1#heading2`
   - Ported from `lib/entities/blocks/smart_block.js`

4. **EntityCollection** (`EntityCollection.ts`)
   - Base collection with CRUD operations
   - AJSON persistence integration
   - Vector search delegation
   - Simplified from `legacy collection implementation`

5. **SourceCollection** (`SourceCollection.ts`)
   - Collection of sources
   - MetadataCache event handlers (create, modify, delete, rename)
   - File discovery from vault

6. **BlockCollection** (`BlockCollection.ts`)
   - Collection of blocks
   - Integrates with SourceCollection
   - Uses markdown splitter for block parsing

### Adapters

**AjsonDataAdapter** (`adapters/ajson-data-adapter.ts`)
- AJSON format persistence (append-only JSON log)
- Format: `"collection_key:item_key": data,`
- Full cache compatibility with existing `.ajson` files
- Automatic file compaction

### Parsers

**markdown-splitter** (`parsers/markdown-splitter.ts`)
- Custom TypeScript markdown block parser
- Uses MetadataCache sections for heading structure
- Falls back to paragraph splitting
- Preserves `#heading1#heading2` block key format

## Data Format Compatibility

### CRITICAL: Embedding Format

The `EntityData.embeddings` structure MUST maintain exact compatibility:

```typescript
{
  embeddings: {
    [model_key]: {
      vec: number[],
      tokens?: number
    }
  }
}
```

**Example:**
```json
{
  "embeddings": {
    "TaylorAI/bge-micro-v2": {
      "vec": [0.1, 0.2, 0.3, ...],
      "tokens": 512
    }
  }
}
```

### Block Key Format

Block keys preserve the existing format:
- `path#heading1` - Top-level heading
- `path#heading1#heading2` - Nested heading
- `path#paragraph-1` - Paragraph block

### AJSON Format

Each `.ajson` file is an append-only log:

```json
"smart_sources:file.md": { path: "file.md", embeddings: {...}, ... },
"smart_sources:file.md": { path: "file.md", embeddings: {...}, ... },
"smart_sources:file.md": null,
```

- Last entry wins
- `null` indicates deletion
- Files auto-compact when >100 lines

## MetadataCache Integration

The framework integrates with Obsidian's MetadataCache:

### Source Updates
- `vault.on('create')` → `SourceCollection.on_file_create()`
- `vault.on('modify')` → `SourceCollection.on_file_modify()`
- `vault.on('delete')` → `SourceCollection.on_file_delete()`
- `vault.on('rename')` → `SourceCollection.on_file_rename()`
- `metadataCache.on('changed')` → `SourceCollection.on_metadata_change()`

### Block Parsing
- Uses `CachedMetadata.headings` for heading structure
- Uses `CachedMetadata.sections` for section boundaries
- Falls back to paragraph splitting for non-heading content

## Usage Example

```typescript
import { SourceCollection, BlockCollection } from './src/shared/entities';

// Create collections
const sources = new SourceCollection(
  data_dir,
  settings,
  embed_model_key,
  vault,
  metadataCache
);

const blocks = new BlockCollection(
  data_dir,
  settings,
  embed_model_key,
  sources
);

// Link collections
sources.block_collection = blocks;

// Initialize
await sources.init();
await blocks.init();

// Load from disk
await sources.load();
await blocks.load();

// Register vault events
vault.on('create', (file) => sources.on_file_create(file));
vault.on('modify', (file) => sources.on_file_modify(file));
vault.on('delete', (file) => sources.on_file_delete(file));
vault.on('rename', (file, oldPath) => sources.on_file_rename(file, oldPath));

metadataCache.on('changed', (file) => sources.on_metadata_change(file));
```

## Key Changes from Legacy

### Improvements
- ✅ Full TypeScript with proper types
- ✅ MetadataCache-driven (no manual file scanning)
- ✅ Simplified architecture (no SmartEnv dependency)
- ✅ Uses `vault.cachedRead()` (respects Obsidian cache)
- ✅ Custom TS markdown splitter
- ✅ Maintains AJSON format compatibility

### Removed Dependencies
- ❌ SmartEnv orchestration
- ❌ SmartFS file tracking
- ❌ Source adapters (vault handles this)
- ❌ Block adapters (direct content access)
- ❌ Legacy data migrations

## Testing

To test the entity framework:

1. Ensure types are correct: `npx tsc --noEmit --skipLibCheck src/shared/entities/*.ts src/shared/entities/**/*.ts`
2. Create test vault with markdown files
3. Initialize collections with vault references
4. Verify AJSON files are created/updated
5. Check MetadataCache event handling

## Future Work

- [ ] Implement actual file system operations in AjsonDataAdapter
- [ ] Add comprehensive unit tests
- [ ] Integrate with embedding pipeline
- [ ] Add performance benchmarks
- [ ] Document migration path from legacy
