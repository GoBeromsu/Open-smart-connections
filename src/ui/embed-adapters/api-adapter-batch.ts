import type { EmbedInput, EmbedResult } from '../../types/models';
import type { EmbedModelApiAdapter } from './api-base';

interface PreparedEntry {
  item: EmbedInput;
  originalIndex: number;
  prepared: string | null;
  token_count: number;
}

function build_request_batches(
  valid: Array<PreparedEntry & { prepared: string }>,
  budget: number,
): Array<Array<PreparedEntry & { prepared: string }>> {
  const batches: Array<Array<PreparedEntry & { prepared: string }>> = [];
  let current_batch: Array<PreparedEntry & { prepared: string }> = [];
  let current_tokens = 0;

  for (const entry of valid) {
    const token_count = Math.max(1, entry.token_count || 0);
    if (current_batch.length > 0 && current_tokens + token_count > budget) {
      batches.push(current_batch);
      current_batch = [];
      current_tokens = 0;
    }
    current_batch.push(entry);
    current_tokens += token_count;
  }

  if (current_batch.length > 0) {
    batches.push(current_batch);
  }

  return batches;
}

export async function embed_api_batch(
  adapter: EmbedModelApiAdapter,
  inputs: (EmbedInput | { _embed_input: string })[],
): Promise<EmbedResult[]> {
  if (!adapter.api_key) throw new Error('API key not set');

  const normalized: Array<{ item: EmbedInput; originalIndex: number }> = [];
  for (let i = 0; i < inputs.length; i++) {
    const raw = inputs[i];
    if (!raw) continue;
    const embed_input = 'embed_input' in raw ? raw.embed_input : raw._embed_input;
    normalized.push({ item: { ...raw, embed_input } as EmbedInput, originalIndex: i });
  }

  const prepared: PreparedEntry[] = await Promise.all(
    normalized.map(async (entry) => {
      if (!entry.item.embed_input || entry.item.embed_input.length === 0) {
        return { ...entry, prepared: null, token_count: 0 };
      }
      const prepared_input = await adapter.prepare_embed_input(entry.item.embed_input);
      if (typeof prepared_input !== 'string' || prepared_input.length === 0) {
        return { ...entry, prepared: null, token_count: 0 };
      }
      return {
        ...entry,
        prepared: prepared_input,
        token_count: await adapter.count_tokens(prepared_input),
      };
    }),
  );

  const results: EmbedResult[] = normalized.map((entry) => ({
    ...entry.item,
    vec: [],
    tokens: 0,
  } as EmbedResult));
  const valid = prepared.filter((entry): entry is PreparedEntry & { prepared: string } => entry.prepared !== null);
  if (valid.length === 0) {
    return results;
  }

  const budget = Math.max(1, adapter.request_token_budget || adapter.max_tokens || 1);
  const request_batches = build_request_batches(valid, budget);

  for (const batch of request_batches) {
    const request_adapter = new adapter.req_adapter(adapter, batch.map((entry) => entry.prepared));
    const request_params = request_adapter.to_platform();
    const response = await adapter.request(request_params);
    const response_adapter = new adapter.res_adapter(adapter, response);
    const embeddings = response_adapter.to_openai();
    if (!embeddings) continue;

    for (let i = 0; i < batch.length && i < embeddings.length; i++) {
      const entry = batch[i];
      const embedding = embeddings[i];
      if (!entry || !embedding) continue;
      const result = results[entry.originalIndex];
      if (!result) continue;
      result.vec = embedding.vec;
      result.tokens = embedding.tokens;
      result.key = embedding.key ?? result.key;
      result.index = embedding.index ?? result.index;
    }
  }

  return results;
}
