import type { EmbedModelSettings, SearchModelSettings } from '../types/settings';

export const LEGACY_GEMINI_EMBED_MODEL_KEY = 'text-embedding-004';
export const DEFAULT_GEMINI_EMBED_MODEL_KEY = 'gemini-embedding-001';
export const UPSTAGE_INDEX_MODEL_KEY = 'embedding-passage';
export const UPSTAGE_SEARCH_MODEL_KEY = 'embedding-query';

const DEFAULT_EMBED_MODEL_KEYS: Record<string, string> = {
  transformers: 'TaylorAI/bge-micro-v2',
  ollama: 'bge-m3',
  openai: 'text-embedding-3-small',
  gemini: DEFAULT_GEMINI_EMBED_MODEL_KEY,
  upstage: UPSTAGE_INDEX_MODEL_KEY,
};

function getAdapterSettings(
  embedModel: EmbedModelSettings,
  adapter: string,
): Record<string, unknown> | undefined {
  const value = embedModel[adapter];
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function normalizeProviderEmbedModelSettings(embedModel: EmbedModelSettings): boolean {
  let changed = false;

  if (embedModel.adapter === 'upstage') {
    let upstage = getAdapterSettings(embedModel, 'upstage');
    if (!upstage) {
      upstage = { model_key: UPSTAGE_INDEX_MODEL_KEY };
      embedModel.upstage = upstage;
      changed = true;
    } else if (upstage.model_key && upstage.model_key !== UPSTAGE_INDEX_MODEL_KEY) {
      upstage.model_key = UPSTAGE_INDEX_MODEL_KEY;
      changed = true;
    }
  }

  if (embedModel.adapter === 'gemini') {
    let gemini = getAdapterSettings(embedModel, 'gemini');
    if (!gemini) {
      gemini = { model_key: DEFAULT_GEMINI_EMBED_MODEL_KEY };
      embedModel.gemini = gemini;
      changed = true;
    } else if (!gemini.model_key || gemini.model_key === LEGACY_GEMINI_EMBED_MODEL_KEY) {
      gemini.model_key = DEFAULT_GEMINI_EMBED_MODEL_KEY;
      changed = true;
    }
  }

  return changed;
}

export function getDefaultEmbedModelKey(adapter: string): string | undefined {
  return DEFAULT_EMBED_MODEL_KEYS[adapter];
}

export function getManagedSearchModel(adapter: string): SearchModelSettings | undefined {
  if (adapter !== 'upstage') return undefined;
  return {
    adapter: 'upstage',
    model_key: UPSTAGE_SEARCH_MODEL_KEY,
  };
}

export function shouldClearManagedSearchModel(
  searchModel: { adapter?: string; model_key?: string } | null | undefined,
  nextAdapter: string,
): boolean {
  if (nextAdapter === 'upstage') return false;
  return searchModel?.adapter === 'upstage' && searchModel.model_key === UPSTAGE_SEARCH_MODEL_KEY;
}

export function resolveEmbeddingRunPolicy(input: {
  adapter: string;
  dims?: number | null;
  configuredSaveInterval?: number;
  configuredConcurrency?: number;
}): { saveInterval: number; concurrency: number } {
  const dims = input.dims ?? 0;
  const configuredSaveInterval = input.configuredSaveInterval || 5;
  const configuredConcurrency = input.configuredConcurrency || 5;

  return {
    saveInterval: dims > 1024 ? 2 : dims > 512 ? 3 : configuredSaveInterval,
    concurrency: input.adapter === 'upstage'
      ? 1
      : dims > 1024
        ? Math.max(1, Math.min(configuredConcurrency, 3))
        : configuredConcurrency,
  };
}
