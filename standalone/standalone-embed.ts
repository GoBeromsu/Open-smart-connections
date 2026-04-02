/**
 * @file standalone-embed.ts
 * @description Lightweight embedding adapter for standalone MCP mode.
 *
 * Reads adapter type and credentials from data.json settings, then calls the
 * provider's embedding endpoint using globalThis.fetch (Node 18+).
 * Only API-based adapters are supported -- transformers is not available
 * outside the Obsidian browser environment.
 */

import type { EmbedModelSettings, SearchModelSettings } from '../src/types/settings';

export interface StandaloneEmbedConfig {
  adapter: string;
  modelKey: string;
  apiKey?: string;
  endpoint?: string;
  dims?: number;
}

/** Build config for the query-time embedding adapter from plugin settings. */
export function resolveEmbedConfig(
  embedModel: EmbedModelSettings,
  searchModel?: SearchModelSettings,
): StandaloneEmbedConfig {
  const adapter = searchModel?.adapter ?? embedModel.adapter;
  const adapterSettings = embedModel[adapter] as Record<string, unknown> | undefined;

  const modelKey = searchModel?.model_key
    ?? (adapterSettings?.model_key as string | undefined)
    ?? 'unknown';
  const apiKey = adapterSettings?.api_key as string | undefined;
  const endpoint = adapterSettings?.endpoint as string | undefined;

  return { adapter, modelKey, apiKey, endpoint };
}

/** Embed a single query string and return the dense vector. */
export async function embedQuery(
  text: string,
  config: StandaloneEmbedConfig,
): Promise<number[]> {
  switch (config.adapter) {
    case 'openai':
      return openaiEmbed(text, config);
    case 'upstage':
      return upstageEmbed(text, config);
    case 'ollama':
      return ollamaEmbed(text, config);
    case 'gemini':
      return geminiEmbed(text, config);
    case 'lm_studio':
      return lmStudioEmbed(text, config);
    case 'open_router':
      return openRouterEmbed(text, config);
    case 'transformers':
      throw new Error('Transformers adapter is not supported in standalone mode.');
    default:
      throw new Error(`Unknown embedding adapter: ${config.adapter}`);
  }
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function openaiEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const url = cfg.endpoint ?? 'https://api.openai.com/v1/embeddings';
  const body: Record<string, unknown> = { model: cfg.modelKey, input: [text] };
  if (cfg.dims) body.dimensions = cfg.dims;
  return openaiCompatibleEmbed(url, cfg.apiKey, body);
}

async function upstageEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const url = cfg.endpoint ?? 'https://api.upstage.ai/v1/embeddings';
  const modelKey = cfg.modelKey === 'embedding-passage' ? 'embedding-query' : cfg.modelKey;
  const body = { model: modelKey, input: [text] };
  return openaiCompatibleEmbed(url, cfg.apiKey, body);
}

async function openRouterEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const url = 'https://openrouter.ai/api/v1/embeddings';
  const body = { model: cfg.modelKey, input: [text] };
  return openaiCompatibleEmbed(url, cfg.apiKey, body);
}

async function lmStudioEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const host = cfg.endpoint ?? 'http://localhost:1234';
  const url = `${host}/api/v0/embeddings`;
  const body = { model: cfg.modelKey, input: [text] };
  return openaiCompatibleEmbed(url, undefined, body);
}

async function ollamaEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const host = cfg.endpoint ?? 'http://localhost:11434';
  const resp = await fetchJson(`${host}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.modelKey, input: [text] }),
  });
  const embeddings = (resp as { embeddings?: number[][] }).embeddings;
  if (!embeddings?.[0]) throw new Error('Ollama returned no embeddings.');
  return embeddings[0];
}

async function geminiEmbed(text: string, cfg: StandaloneEmbedConfig): Promise<number[]> {
  const model = cfg.modelKey.startsWith('models/') ? cfg.modelKey : `models/${cfg.modelKey}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent`;
  const resp = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey ?? '',
    },
    body: JSON.stringify({
      model,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
    }),
  });
  const values = (resp as { embedding?: { values?: number[] } }).embedding?.values;
  if (!values?.length) throw new Error('Gemini returned no embedding.');
  return values;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function openaiCompatibleEmbed(
  url: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<number[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const resp = await fetchJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = (resp as { data?: { embedding?: number[] }[] }).data;
  if (!data?.[0]?.embedding) throw new Error(`Embedding API returned no data from ${url}`);
  return data[0].embedding;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const resp = await globalThis.fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} from ${url}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}
