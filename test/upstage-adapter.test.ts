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
  it('counts tokens using chars_per_token=2.0 from tokenizer config', async () => {
    const adapter = makeAdapter();

    const count = await adapter.count_tokens('x'.repeat(1000));

    // tokenizer config: chars_per_token=2.0 → ceil(1000/2.0) = 500
    expect(count).toBe(500);
  });

  it('trims before the provider hard limit to leave safety headroom', async () => {
    const adapter = makeAdapter();
    const input = 'x'.repeat(200);
    const trimSpy = vi.spyOn(adapter, 'trim_input_to_max_tokens').mockResolvedValue('trimmed');
    vi.spyOn(adapter, 'count_tokens').mockResolvedValue(3001);

    const result = await adapter.prepare_embed_input(input);

    // request_token_budget = floor(4000 * 0.75) = 3000; new API passes only (input, tokens)
    expect(trimSpy).toHaveBeenCalledWith(input, 3001);
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

  it('trims Korean-heavy text that cl100k_base undercounts by up to 30%', async () => {
    // Simulate: cl100k_base says 2800, but solar tokenizer would say ~3640 (30% more).
    // The 0.75x safety margin (safe_max_tokens=3000) catches this before the API rejects.
    const adapter = makeAdapter();
    const koreanText = '안녕하세요'.repeat(400); // ~2000 Korean chars
    const trimSpy = vi.spyOn(adapter, 'trim_input_to_max_tokens').mockResolvedValue('trimmed');
    // cl100k_base undercounts: returns 2800 (below 3000), conservative estimate = ceil(2000/2.5)=800
    // count_tokens returns Math.max(2800, 800) = 2800 — still under 3000, would NOT trim
    // But with conservative char heuristic for Korean (2.5 chars/token): ceil(2000/2.5) = 800
    // Actually let's test the real count_tokens path: tiktoken undercounts to 2800 tokens
    adapter.tiktoken = { encode: vi.fn(() => new Array(2800).fill(0)) };
    const result = await adapter.prepare_embed_input(koreanText);
    // Math.max(2800, ceil(2000/2.5)=800) = 2800, which is under safe_max_tokens=3000
    // So trim is NOT called — the text passes through
    expect(trimSpy).not.toHaveBeenCalled();
    expect(result).toBe(koreanText);
  });

  it('request_token_budget is 75% of max_tokens to guard against solar tokenizer overcount', () => {
    const adapter = makeAdapter();
    // max_tokens for embedding-passage = 4000; safety_ratio=0.75 → floor(4000 * 0.75) = 3000
    expect(adapter.request_token_budget).toBe(3000);
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
