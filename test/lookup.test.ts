/**
 * @file lookup.test.ts
 * @description Tests for hypothetical embedding lookup
 */

import { describe, it, expect, vi } from 'vitest';
import { lookup, batch_lookup } from '../src/shared/search/lookup';
import type { EmbeddingEntity } from '../src/shared/entities/EmbeddingEntity';
import type { EmbedModelAdapter, EmbedResult } from '../src/shared/types/models';

function createMockEntity(key: string, vec: number[] | null): EmbeddingEntity {
  const entity: any = {
    key,
    data: {
      path: key.split('#')[0],
      embeddings: {
        'test-model': vec ? { vec } : {},
      },
    },
    vec,
    _queue_embed: false,
    queue_embed: () => {
      entity._queue_embed = true;
    },
  };
  return entity as EmbeddingEntity;
}

function createEmbedModel(results: EmbedResult[]): EmbedModelAdapter {
  return {
    adapter: 'test',
    model_key: 'test-model',
    dims: 2,
    models: {},
    settings: {},
    embed_batch: vi.fn(async () => results),
    get_model_info: () => undefined,
    count_tokens: async () => 0,
  };
}

describe('lookup', () => {
  it('returns empty for blank query without calling embed model', async () => {
    const model = createEmbedModel([{ vec: [1, 0] }]);

    const results = await lookup('   ', model, []);

    expect(results).toEqual([]);
    expect(model.embed_batch).not.toHaveBeenCalled();
  });

  it('throws when embed model returns no vector', async () => {
    const model = createEmbedModel([] as EmbedResult[]);

    await expect(lookup('query', model, [])).rejects.toThrow('Failed to embed query');
  });

  it('filters to sources only', async () => {
    const model = createEmbedModel([{ vec: [1, 0] }]);
    const entities = [
      createMockEntity('source-a.md', [1, 0]),
      createMockEntity('source-b.md#h1', [1, 0]),
    ];

    const results = await lookup('query', model, entities, { sources_only: true });

    expect(results).toHaveLength(1);
    expect(results[0].item.key).toBe('source-a.md');
  });

  it('filters to blocks only', async () => {
    const model = createEmbedModel([{ vec: [1, 0] }]);
    const entities = [
      createMockEntity('source-a.md', [1, 0]),
      createMockEntity('source-b.md#h1', [1, 0]),
    ];

    const results = await lookup('query', model, entities, { blocks_only: true });

    expect(results).toHaveLength(1);
    expect(results[0].item.key).toBe('source-b.md#h1');
  });
});

describe('batch_lookup', () => {
  it('skips empty queries before embedding', async () => {
    const model = createEmbedModel([{ vec: [1, 0] }, { vec: [0, 1] }]);
    const entities = [createMockEntity('a.md', [1, 0])];

    const results = await batch_lookup(['', 'first', '   ', 'second'], model, entities);

    expect(model.embed_batch).toHaveBeenCalledTimes(1);
    expect(model.embed_batch).toHaveBeenCalledWith([
      { _embed_input: 'first' },
      { _embed_input: 'second' },
    ]);
    expect(results).toHaveLength(2);
  });

  it('returns empty result for embed entries without vectors', async () => {
    const model = createEmbedModel([{ vec: [1, 0] }, {} as EmbedResult]);
    const entities = [createMockEntity('a.md', [1, 0])];

    const results = await batch_lookup(['first', 'second'], model, entities);

    expect(results).toHaveLength(2);
    expect(results[0].length).toBeGreaterThan(0);
    expect(results[1]).toEqual([]);
  });
});
