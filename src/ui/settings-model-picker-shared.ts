import { TRANSFORMERS_EMBED_MODELS } from './embed-adapters/transformers';
import { embedAdapterRegistry } from '../domain/embed-model';

export interface ConfirmReembedFn {
  (message: string): Promise<boolean>;
}

export interface ConfigAccessor {
  getConfig<T>(path: string, fallback: T): T;
  setConfig(path: string, value: unknown): void;
}

export interface ModelPickerDeps {
  containerEl: HTMLElement;
  adapterName: string;
  config: ConfigAccessor;
  confirmReembed: ConfirmReembedFn;
  triggerReEmbed: () => Promise<void>;
  display: () => void;
}

export interface SearchModelPickerDeps {
  containerEl: HTMLElement;
  config: ConfigAccessor;
  onChanged: () => void;
  display: () => void;
}

export const OLLAMA_QUICK_PICKS: Array<{ value: string; name: string }> = [
  { value: 'bge-m3', name: 'bge-m3' },
  { value: 'nomic-embed-text', name: 'nomic-embed-text' },
  { value: 'snowflake-arctic-embed2', name: 'snowflake-arctic-embed2' },
  { value: 'mxbai-embed-large', name: 'mxbai-embed-large' },
];

const TRANSFORMERS_MODEL_ORDER = [
  'TaylorAI/bge-micro-v2',
  'Xenova/bge-m3',
  'Xenova/multilingual-e5-large',
  'Xenova/multilingual-e5-small',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  'nomic-ai/nomic-embed-text-v1.5',
  'Xenova/bge-small-en-v1.5',
  'Snowflake/snowflake-arctic-embed-xs',
  'Snowflake/snowflake-arctic-embed-s',
  'Snowflake/snowflake-arctic-embed-m',
  'Xenova/jina-embeddings-v2-small-en',
  'Xenova/jina-embeddings-v2-base-zh',
  'andersonbcdefg/bge-small-4096',
  'TaylorAI/gte-tiny',
  'onnx-community/embeddinggemma-300m-ONNX',
  'Mihaiii/Ivysaur',
  'nomic-ai/nomic-embed-text-v1',
] as const;

export function getTransformersKnownModels(): Array<{ value: string; name: string }> {
  const configuredOrder = TRANSFORMERS_MODEL_ORDER.filter((key) => !!TRANSFORMERS_EMBED_MODELS[key]);
  const remaining = Object.keys(TRANSFORMERS_EMBED_MODELS)
    .filter((key) => !(configuredOrder as string[]).includes(key))
    .sort((a, b) => a.localeCompare(b));

  return [...configuredOrder, ...remaining].map((modelKey) => {
    const model = TRANSFORMERS_EMBED_MODELS[modelKey];
    const dims = model?.dims ? `${model.dims}d` : 'dims?';
    const modelName = model?.model_name || modelKey.split('/').pop() || modelKey;
    return { value: modelKey, name: `${modelName} (${dims})` };
  });
}

export function getKnownModels(): Record<string, Array<{ value: string; name: string }>> {
  const result: Record<string, Array<{ value: string; name: string }>> = {
    transformers: getTransformersKnownModels(),
    ollama: OLLAMA_QUICK_PICKS,
  };

  for (const registration of embedAdapterRegistry.getAll()) {
    if (registration.name === 'transformers' || registration.name === 'ollama') continue;
    const options = embedAdapterRegistry.getModelPickerOptions(registration.name);
    if (options.length > 0) {
      result[registration.name] = options;
    }
  }

  return result;
}

export function resolveModelDims(adapterName: string, modelKey: string): number | null {
  const registration = embedAdapterRegistry.get(adapterName);
  if (!registration) return null;
  return registration.models[modelKey]?.dims ?? null;
}
