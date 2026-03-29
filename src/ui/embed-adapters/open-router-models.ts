import type { ModelInfo } from '../../types/models';

export const OPEN_ROUTER_SIGNUP_URL = 'https://openrouter.ai/keys';

export function build_open_router_fallback_model(max_tokens: number): Record<string, ModelInfo> {
  const fallback_id = 'text-embedding-3-small';
  return {
    [fallback_id]: {
      model_key: fallback_id,
      model_name: fallback_id,
      description: 'OpenRouter embedding model',
      max_tokens,
    },
  };
}

export function parse_open_router_model_data(
  model_data: Record<string, unknown> | unknown[],
  fallback_max_tokens: number,
): Record<string, ModelInfo> {
  let list: Record<string, unknown>[] = [];
  if (Array.isArray((model_data as Record<string, unknown>)?.data)) {
    list = (model_data as Record<string, unknown>).data as Record<string, unknown>[];
  } else if (Array.isArray(model_data)) {
    list = model_data as Record<string, unknown>[];
  } else {
    return { _: { model_key: 'No models found.' } };
  }

  const out: Record<string, ModelInfo> = {};
  for (const model of list) {
    const model_id = (model.id || model.name) as string | undefined;
    if (!model_id || !is_open_router_embedding_model(model_id)) continue;
    out[model_id] = {
      model_key: model_id,
      model_name: model_id,
      max_tokens: (model.context_length as number) || fallback_max_tokens,
      description: (model.name as string) || (model.description as string) || `Model: ${model_id}`,
    };
  }

  return Object.keys(out).length ? out : { _: { model_key: 'No embedding models found.' } };
}

function is_open_router_embedding_model(id: string): boolean {
  const lower = String(id || '').toLowerCase();
  const segments = lower.split(/[-:/_]/);
  if (segments.some((segment) => ['embed', 'embedding', 'bge'].includes(segment))) return true;
  return lower.includes('text-embedding');
}
