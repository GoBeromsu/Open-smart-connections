import { describe, expect, it, vi } from 'vitest';
import { UpstageEmbedAdapter, UPSTAGE_EMBED_MODELS } from '../src/ui/embed-adapters/upstage';

function makeAdapter(): UpstageEmbedAdapter {
  return new UpstageEmbedAdapter({
    adapter: 'upstage',
    model_key: 'embedding-passage',
    dims: 4096,
    models: UPSTAGE_EMBED_MODELS,
    settings: { api_key: 'test-key' },
  });
}

describe('UpstageEmbedAdapter.prepare_embed_input', () => {
  it('counts tokens using chars_per_token=1.2 from tokenizer config', async () => {
    const adapter = makeAdapter();

    const count = await adapter.count_tokens('x'.repeat(1000));

    expect(count).toBe(834);
  });

  it('trims before the provider hard limit to leave safety headroom', async () => {
    const adapter = makeAdapter();
    const input = 'x'.repeat(200);
    const trimSpy = vi.spyOn(adapter, 'trim_input_to_max_tokens').mockResolvedValue('trimmed');
    vi.spyOn(adapter, 'count_tokens').mockResolvedValue(3601);

    const result = await adapter.prepare_embed_input(input);

    expect(trimSpy).toHaveBeenCalledWith(input, 3601);
    expect(result).toBe('trimmed');
  });

  it('returns the input unchanged when it is safely below the trimmed threshold', async () => {
    const adapter = makeAdapter();
    const input = 'safe input';
    const trimSpy = vi.spyOn(adapter, 'trim_input_to_max_tokens');
    vi.spyOn(adapter, 'count_tokens').mockResolvedValue(2800);

    const result = await adapter.prepare_embed_input(input);

    expect(trimSpy).not.toHaveBeenCalled();
    expect(result).toBe(input);
  });

  it('request_token_budget is 90% of max_tokens for Korean-optimized safety margin', () => {
    const adapter = makeAdapter();
    expect(adapter.request_token_budget).toBe(3600);
  });

  it('sends one request per input to stay below the provider request token cap', async () => {
    const adapter = makeAdapter();
    const requestSpy = vi.spyOn(adapter, 'request').mockImplementation(async (req) => {
      const body = JSON.parse(String(req.body)) as { input: string[] };
      return {
        data: body.input.map((_, index) => ({ embedding: [index + 1] })),
        usage: { total_tokens: body.input.length * 100 },
      };
    });
    vi.spyOn(adapter, 'count_tokens').mockResolvedValue(1500);
    vi.spyOn(adapter, 'prepare_embed_input').mockImplementation(async (input) => input);

    const results = await adapter.embed_batch([
      { key: 'a', index: 0, embed_input: 'alpha' },
      { key: 'b', index: 1, embed_input: 'beta' },
      { key: 'c', index: 2, embed_input: 'gamma' },
    ]);

    expect(requestSpy).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    expect(results.map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(results.every((item) => Array.isArray(item.vec) && item.vec.length === 1)).toBe(true);
  });
});
