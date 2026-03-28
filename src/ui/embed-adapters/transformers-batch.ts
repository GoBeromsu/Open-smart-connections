import type { EmbedInput, EmbedResult } from '../../types/models';

export function build_transformers_batch_results(
  inputs: (EmbedInput | { _embed_input: string })[],
): {
  results: EmbedResult[];
  valid_inputs: EmbedInput[];
  valid_indexes: number[];
} {
  const normalized = inputs.map((item, index) => {
    const embed_input = 'embed_input' in item ? item.embed_input : item._embed_input;
    return {
      item: { ...item, embed_input } as EmbedInput,
      original_index: index,
    };
  });

  const results: EmbedResult[] = normalized.map((entry) => ({
    ...entry.item,
    vec: [],
    tokens: 0,
  } as EmbedResult));
  const valid = normalized.filter((entry) => (entry.item.embed_input?.length ?? 0) > 0);
  return {
    results,
    valid_inputs: valid.map((entry) => entry.item),
    valid_indexes: valid.map((entry) => entry.original_index),
  };
}
