import { describe, expect, it } from 'vitest';
import { embedAdapterRegistry } from '../src/domain/embed-model';
import '../src/ui/embedding/register-embed-adapters';

describe('EmbedAdapterRegistry', () => {
  it('has only transformers and upstage registered', () => {
    const names = embedAdapterRegistry.getAdapterNames().sort();
    expect(names).toEqual(['transformers', 'upstage']);
  });

  it('upstage has supportsBatch: true', () => {
    const reg = embedAdapterRegistry.get('upstage');
    expect(reg?.supportsBatch).toBe(true);
  });

  it('transformers has supportsBatch: false', () => {
    const reg = embedAdapterRegistry.get('transformers');
    expect(reg?.supportsBatch).toBe(false);
  });

  it('upstage requires API key', () => {
    const reg = embedAdapterRegistry.get('upstage');
    expect(reg?.requiresApiKey).toBe(true);
  });

  it('transformers does not require API key', () => {
    const reg = embedAdapterRegistry.get('transformers');
    expect(reg?.requiresApiKey).toBe(false);
  });

  it('createAdapter creates upstage adapter with correct dims', () => {
    const { adapter } = embedAdapterRegistry.createAdapter(
      'upstage',
      'embedding-passage',
      { api_key: 'test', model_key: 'embedding-passage' },
    );
    expect(adapter.adapter).toBe('upstage');
    expect(adapter.dims).toBe(4096);
  });

  it('throws for unregistered adapter', () => {
    expect(() => embedAdapterRegistry.createAdapter('openai', 'test', {}))
      .toThrow(/Unknown embed adapter: openai/);
  });
});
