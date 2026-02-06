/**
 * @file cache-compatibility.test.ts
 * @description Critical tests to ensure cache format compatibility with existing data
 * CRITICAL: These tests verify that refactored code maintains exact data structure
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingEntity } from '../core/entities/EmbeddingEntity';
import { EntityCollection } from '../core/entities/EntityCollection';
import { AjsonDataAdapter } from '../core/entities/adapters/ajson-data-adapter';
import type { EntityData, SourceData, BlockData } from '../core/types/entities';

describe('Cache Compatibility - Entity Data Format', () => {
  it('should maintain exact embeddings data structure', () => {
    const mockCollection = {
      embed_model_key: 'TaylorAI/bge-micro-v2',
      settings: {},
    } as any;

    // Sample data matching existing cache format
    const existingCacheData: EntityData = {
      path: 'Test Note.md',
      embeddings: {
        'TaylorAI/bge-micro-v2': {
          vec: [0.123, -0.456, 0.789],
          tokens: 512,
        },
      },
      last_read: {
        hash: 'abc123',
        size: 1024,
        mtime: 1234567890,
      },
      last_embed: {
        hash: 'abc123',
      },
    };

    const entity = new EmbeddingEntity(mockCollection, existingCacheData);

    // Verify structure is preserved exactly
    expect(entity.data.embeddings['TaylorAI/bge-micro-v2']).toEqual({
      vec: [0.123, -0.456, 0.789],
      tokens: 512,
    });

    expect(entity.vec).toEqual([0.123, -0.456, 0.789]);
    expect(entity.tokens).toBe(512);
  });

  it('should preserve block key format: path#heading1#heading2', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      settings: {},
    } as any;

    // Block with nested headings
    const blockData: Partial<BlockData> = {
      path: 'Note.md#Introduction#Background',
      embeddings: {
        'test-model': {
          vec: [1, 2, 3],
        },
      },
    };

    const entity = new EmbeddingEntity(mockCollection, blockData as EntityData);

    expect(entity.key).toBe('Note.md#Introduction#Background');
    expect(entity.data.path).toBe('Note.md#Introduction#Background');
  });

  it('should not trigger re-embedding for valid cached items', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      settings: {},
    } as any;

    // Entity with valid embedding and matching hashes
    const cachedData: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': {
          vec: [1, 2, 3],
          tokens: 100,
        },
      },
      last_read: {
        hash: 'content_hash_123',
      },
      last_embed: {
        hash: 'content_hash_123',
      },
    };

    const entity = new EmbeddingEntity(mockCollection, cachedData);
    entity.init();

    // Should NOT queue for embedding (hashes match)
    expect(entity.is_unembedded).toBe(false);
    expect(entity._queue_embed).toBe(false);
  });

  it('should trigger re-embedding when content hash changed', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      settings: { min_chars: 10 },
    } as any;

    // Entity with embedding but mismatched hashes
    const staleData: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': {
          vec: [1, 2, 3],
          tokens: 100,
        },
      },
      last_read: {
        hash: 'new_content_hash',
      },
      last_embed: {
        hash: 'old_content_hash',
      },
    };

    const entity = new EmbeddingEntity(mockCollection, staleData);

    // Override size to pass should_embed check
    Object.defineProperty(entity, 'size', { get: () => 500 });

    entity.init();

    // Should detect as unembedded (hashes don't match)
    expect(entity.is_unembedded).toBe(true);
  });

  it('should remove embeddings from inactive models', () => {
    const mockCollection = {
      embed_model_key: 'new-model',
      settings: {},
    } as any;

    // Cache with multiple model embeddings
    const multiModelData: EntityData = {
      path: 'test.md',
      embeddings: {
        'old-model-1': { vec: [1, 2, 3] },
        'old-model-2': { vec: [4, 5, 6] },
        'new-model': { vec: [7, 8, 9] },
      },
    };

    const entity = new EmbeddingEntity(mockCollection, multiModelData);
    entity.init();

    // Only active model embedding should remain
    expect(entity.data.embeddings['new-model']).toBeDefined();
    expect(entity.data.embeddings['old-model-1']).toBeUndefined();
    expect(entity.data.embeddings['old-model-2']).toBeUndefined();
  });
});

describe('Cache Compatibility - AJSON Format', () => {
  it('should parse AJSON line format correctly', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      data_dir: '/test',
      settings: {},
      delete: () => {},
      create_or_update: (data: EntityData) => data,
      size: 0,
    } as any;

    const adapter = new AjsonDataAdapter(mockCollection);

    // Sample AJSON content (collection_key:item_key format)
    const ajsonContent = `"smart_sources:test.md": {"path":"test.md","embeddings":{"test-model":{"vec":[1,2,3]}}},`;

    const entries = adapter.parse_ajson(ajsonContent);

    expect(entries.size).toBe(1);
    expect(entries.has('test.md')).toBe(true);

    const data = entries.get('test.md')!;
    expect(data.path).toBe('test.md');
    expect(data.embeddings['test-model'].vec).toEqual([1, 2, 3]);
  });

  it('should build AJSON line in correct format', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      data_dir: '/test',
      settings: {},
    } as any;

    const adapter = new AjsonDataAdapter(mockCollection);

    const entityData: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': {
          vec: [1, 2, 3],
          tokens: 100,
        },
      },
    };

    const mockEntity = {
      key: 'test.md',
      data: entityData,
    } as any;

    const ajsonLine = adapter.build_ajson_line(mockEntity);

    // Should be: "collection_key:entity_key": data,
    expect(ajsonLine).toContain('"smart_sources:test.md"');
    expect(ajsonLine).toContain('"path":"test.md"');
    expect(ajsonLine).toContain('"vec":[1,2,3]');
    expect(ajsonLine).toContain('"tokens":100');
    expect(ajsonLine.endsWith(',')).toBe(true);
  });

  it('should handle multiple AJSON entries', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      data_dir: '/test',
      settings: {},
      delete: () => {},
      create_or_update: (data: EntityData) => data,
      size: 0,
    } as any;

    const adapter = new AjsonDataAdapter(mockCollection);

    // Multiple entries (simulating append-only log)
    const ajsonContent = `
"smart_sources:a.md": {"path":"a.md","embeddings":{"test-model":{"vec":[1,2,3]}}},
"smart_sources:b.md": {"path":"b.md","embeddings":{"test-model":{"vec":[4,5,6]}}},
"smart_sources:a.md": {"path":"a.md","embeddings":{"test-model":{"vec":[7,8,9]}}},
    `.trim();

    const entries = adapter.parse_ajson(ajsonContent);

    expect(entries.size).toBe(2);
    // Latest entry for a.md should win
    expect(entries.get('a.md')!.embeddings['test-model'].vec).toEqual([7, 8, 9]);
    expect(entries.get('b.md')!.embeddings['test-model'].vec).toEqual([4, 5, 6]);
  });

  it('should handle deletion entries (null data)', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      data_dir: '/test',
      settings: {},
      delete: () => {},
      create_or_update: (data: EntityData) => data,
      size: 0,
    } as any;

    const adapter = new AjsonDataAdapter(mockCollection);

    const ajsonContent = `
"smart_sources:a.md": {"path":"a.md","embeddings":{}},
"smart_sources:b.md": {"path":"b.md","embeddings":{}},
"smart_sources:a.md": null,
    `.trim();

    const entries = adapter.parse_ajson(ajsonContent);

    expect(entries.size).toBe(2);
    expect(entries.get('a.md')).toBeNull(); // Deleted
    expect(entries.get('b.md')).not.toBeNull();
  });

  it('should convert entity key to safe filename', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      data_dir: '/test',
      settings: {},
    } as any;

    const adapter = new AjsonDataAdapter(mockCollection);

    // File path should become safe filename
    expect(adapter.key_to_filename('My Notes.md')).toBe('My_Notes');
    expect(adapter.key_to_filename('folder/file.md')).toBe('folder_file');
    expect(adapter.key_to_filename('file.md#heading')).toBe('file'); // Before #
  });
});

describe('Cache Compatibility - Real-world Scenarios', () => {
  it('should handle source entity with full metadata', () => {
    const mockCollection = {
      embed_model_key: 'TaylorAI/bge-micro-v2',
      settings: {},
    } as any;

    // Realistic source data from cache
    const sourceData: Partial<SourceData> = {
      path: 'Daily Notes/2024-01-15.md',
      extension: 'md',
      size: 2048,
      mtime: 1705334400000,
      embeddings: {
        'TaylorAI/bge-micro-v2': {
          vec: Array(384).fill(0).map(() => Math.random()),
          tokens: 512,
        },
      },
      last_read: {
        hash: 'content_hash_xyz',
        size: 2048,
        mtime: 1705334400000,
      },
      last_embed: {
        hash: 'content_hash_xyz',
      },
      is_excluded: false,
    };

    const entity = new EmbeddingEntity(mockCollection, sourceData as EntityData);

    expect(entity.key).toBe('Daily Notes/2024-01-15.md');
    expect(entity.vec).toHaveLength(384);
    expect(entity.is_unembedded).toBe(false);
  });

  it('should handle block entity with heading hierarchy', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      settings: {},
    } as any;

    // Block data with nested headings
    const blockData: Partial<BlockData> = {
      path: 'Project Notes.md#Overview#Goals#Q1 Objectives',
      source_path: 'Project Notes.md',
      text: 'Complete the refactoring by end of Q1',
      length: 42,
      lines: [10, 12],
      headings: ['Overview', 'Goals', 'Q1 Objectives'],
      embeddings: {
        'test-model': {
          vec: [1, 2, 3],
          tokens: 15,
        },
      },
    };

    const entity = new EmbeddingEntity(mockCollection, blockData as EntityData);

    // Key should maintain full heading hierarchy
    expect(entity.key).toBe('Project Notes.md#Overview#Goals#Q1 Objectives');
    expect(entity.data.path).toBe('Project Notes.md#Overview#Goals#Q1 Objectives');
  });

  it('should preserve custom metadata fields', () => {
    const mockCollection = {
      embed_model_key: 'test-model',
      settings: {},
    } as any;

    // Entity with custom fields
    const customData: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
      custom_field: 'custom_value',
      metadata: {
        tags: ['important', 'review'],
      },
    };

    const entity = new EmbeddingEntity(mockCollection, customData);

    // Custom fields should be preserved
    expect((entity.data as any).custom_field).toBe('custom_value');
    expect((entity.data as any).metadata).toEqual({
      tags: ['important', 'review'],
    });
  });
});
