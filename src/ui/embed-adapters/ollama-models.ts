import type { ModelInfo } from '../../types/models';

export const OLLAMA_SIGNUP_URL = 'https://ollama.com/download';

export interface OllamaModel {
  name: string;
  [key: string]: unknown;
}

export function filter_embedding_models(models: OllamaModel[]): OllamaModel[] {
  if (!Array.isArray(models)) {
    throw new TypeError('models must be an array');
  }
  return models.filter((model) =>
    ['embed', 'embedding', 'bge'].some((keyword) => model.name.toLowerCase().includes(keyword)),
  );
}

export function parse_ollama_model_data(
  model_data: Record<string, unknown>[],
  fallback_max_tokens: number,
): Record<string, ModelInfo> {
  if (!Array.isArray(model_data)) {
    return {};
  }

  if (model_data.length === 0) {
    return {
      no_models_available: {
        model_key: 'no_models_available',
        model_name: 'No models currently available',
      },
    };
  }

  return model_data.reduce<Record<string, ModelInfo>>((accumulator, model) => {
    const info = (model.model_info || {}) as Record<string, unknown>;
    const context_length = Object.entries(info).find(([key]) => key.includes('context_length'))?.[1] as
      | number
      | undefined;
    const dims = Object.entries(info).find(([key]) => key.includes('embedding_length'))?.[1] as
      | number
      | undefined;
    const name = model.name as string;

    accumulator[name] = {
      model_key: name,
      model_name: name,
      max_tokens: context_length || fallback_max_tokens,
      dims,
      description: (model.description as string) || `Model: ${name}`,
    };
    return accumulator;
  }, {});
}
