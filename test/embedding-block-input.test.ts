import { describe, expect, it } from 'vitest';

import { EmbeddingBlock } from '../src/domain/entities/EmbeddingBlock';
import { DEFAULT_EMBED_INPUT_MAX_CHARS } from '../src/domain/entities/embed-input-limit';

describe('EmbeddingBlock.get_embed_input', () => {
  it('caps block input length to the shared embedding input ceiling', async () => {
    const block = new EmbeddingBlock({
      settings: {},
      embed_model_key: 'test-model',
    } as any, {
      path: 'folder/note.md#heading',
      text: '',
      length: 5000,
      embeddings: {},
    });

    await block.get_embed_input('a'.repeat(DEFAULT_EMBED_INPUT_MAX_CHARS * 2));

    expect(block._embed_input).toBeDefined();
    expect(block._embed_input!.length).toBe(DEFAULT_EMBED_INPUT_MAX_CHARS);
    expect(block._embed_input).toContain('folder > note');
  });
});
