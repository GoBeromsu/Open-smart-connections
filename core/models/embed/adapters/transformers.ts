/**
 * @file transformers.ts
 * @description Adapter for local Transformers.js embedding models
 * Uses a hidden iframe (not Web Worker) for model loading and inference.
 * Obsidian's app://obsidian.md origin blocks cross-origin Worker creation,
 * but iframes with srcdoc share the same origin and can do dynamic import()
 * from CDN. This matches the proven v3.0.80 approach.
 */

import type { EmbedInput, EmbedResult, ModelInfo } from '../../../types/models';

/**
 * Transformers.js embedding models configuration
 */
export const TRANSFORMERS_EMBED_MODELS: Record<string, ModelInfo> = {
  'TaylorAI/bge-micro-v2': {
    model_key: 'TaylorAI/bge-micro-v2',
    model_name: 'BGE-micro-v2',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim (recommended)',
  },
  'Snowflake/snowflake-arctic-embed-xs': {
    model_key: 'Snowflake/snowflake-arctic-embed-xs',
    model_name: 'Snowflake Arctic Embed XS',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim',
  },
  'Snowflake/snowflake-arctic-embed-s': {
    model_key: 'Snowflake/snowflake-arctic-embed-s',
    model_name: 'Snowflake Arctic Embed Small',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim',
  },
  'Snowflake/snowflake-arctic-embed-m': {
    model_key: 'Snowflake/snowflake-arctic-embed-m',
    model_name: 'Snowflake Arctic Embed Medium',
    batch_size: 1,
    dims: 768,
    max_tokens: 512,
    description: 'Local, 512 tokens, 768 dim',
  },
  'TaylorAI/gte-tiny': {
    model_key: 'TaylorAI/gte-tiny',
    model_name: 'GTE-tiny',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim',
  },
  'onnx-community/embeddinggemma-300m-ONNX': {
    model_key: 'onnx-community/embeddinggemma-300m-ONNX',
    model_name: 'EmbeddingGemma-300M',
    batch_size: 1,
    dims: 768,
    max_tokens: 2048,
    description: 'Local, 2,048 tokens, 768 dim',
  },
  'Mihaiii/Ivysaur': {
    model_key: 'Mihaiii/Ivysaur',
    model_name: 'Ivysaur',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim',
  },
  'andersonbcdefg/bge-small-4096': {
    model_key: 'andersonbcdefg/bge-small-4096',
    model_name: 'BGE-small-4K',
    batch_size: 1,
    dims: 384,
    max_tokens: 4096,
    description: 'Local, 4,096 tokens, 384 dim',
  },
  'Xenova/jina-embeddings-v2-base-zh': {
    model_key: 'Xenova/jina-embeddings-v2-base-zh',
    model_name: 'Jina-v2-base-zh-8K',
    batch_size: 1,
    dims: 768,
    max_tokens: 8192,
    description: 'Local, 8,192 tokens, 768 dim, Chinese/English bilingual',
  },
  'Xenova/jina-embeddings-v2-small-en': {
    model_key: 'Xenova/jina-embeddings-v2-small-en',
    model_name: 'Jina-v2-small-en',
    batch_size: 1,
    dims: 512,
    max_tokens: 8192,
    description: 'Local, 8,192 tokens, 512 dim',
  },
  'nomic-ai/nomic-embed-text-v1.5': {
    model_key: 'nomic-ai/nomic-embed-text-v1.5',
    model_name: 'Nomic-embed-text-v1.5',
    batch_size: 1,
    dims: 768,
    max_tokens: 2048,
    description: 'Local, 8,192 tokens, 768 dim',
  },
  'Xenova/bge-small-en-v1.5': {
    model_key: 'Xenova/bge-small-en-v1.5',
    model_name: 'BGE-small',
    batch_size: 1,
    dims: 384,
    max_tokens: 512,
    description: 'Local, 512 tokens, 384 dim',
  },
  'nomic-ai/nomic-embed-text-v1': {
    model_key: 'nomic-ai/nomic-embed-text-v1',
    model_name: 'Nomic-embed-text',
    batch_size: 1,
    dims: 768,
    max_tokens: 2048,
    description: 'Local, 2,048 tokens, 768 dim',
  },
};

/**
 * Inline connector script for the embedding iframe.
 * This runs inside a hidden iframe and handles transformers.js model
 * loading and inference via postMessage communication with the main window.
 */
const EMBED_CONNECTOR = `
let pipeline = null;
let tokenizer = null;
let current_model_key = null;
let processing_message = false;

async function is_webgpu_available() {
  if (!('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch(e) { return false; }
}

async function load_transformers_with_fallback(model_key, use_gpu) {
  const { pipeline: createPipeline, env, AutoTokenizer } = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0'
  );

  env.allowLocalModels = false;
  if (typeof env.useBrowserCache !== 'undefined') {
    env.useBrowserCache = true;
  }

  const configs = use_gpu ? [
    { device: 'webgpu', dtype: 'fp32', quantized: false },
    { device: 'webgpu', dtype: 'q8', quantized: true },
    { quantized: true },
    { quantized: false }
  ] : [
    { quantized: true },
    { quantized: false }
  ];

  // Set WASM threads for CPU mode
  if (!use_gpu && env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = 8;
  }

  let last_error = null;
  for (const config of configs) {
    try {
      console.log('[Transformers Iframe] trying config:', JSON.stringify(config));
      pipeline = await createPipeline('feature-extraction', model_key, config);
      console.log('[Transformers Iframe] pipeline initialized');
      break;
    } catch (err) {
      console.warn('[Transformers Iframe] config failed:', err);
      last_error = err;
    }
  }

  if (!pipeline) {
    throw last_error || new Error('Failed to initialize transformers pipeline');
  }

  tokenizer = await AutoTokenizer.from_pretrained(model_key);
  current_model_key = model_key;
}

async function count_tokens(input) {
  if (!tokenizer) throw new Error('Tokenizer not loaded');
  const { input_ids } = await tokenizer(input);
  return { tokens: input_ids.data.length };
}

async function prepare_input(embed_input, max_tokens) {
  let { tokens } = await count_tokens(embed_input);
  if (tokens <= max_tokens) return { text: embed_input, tokens };

  let truncated = embed_input;
  while (tokens > max_tokens && truncated.length > 0) {
    const pct = max_tokens / tokens;
    const max_chars = Math.floor(truncated.length * pct * 0.9);
    truncated = truncated.slice(0, max_chars);
    const last_space = truncated.lastIndexOf(' ');
    if (last_space > 0) truncated = truncated.slice(0, last_space);
    tokens = (await count_tokens(truncated)).tokens;
  }
  return { text: truncated, tokens };
}

async function process_batch(inputs, max_tokens, batch_size) {
  const results = [];
  for (let i = 0; i < inputs.length; i += batch_size) {
    const batch = inputs.slice(i, i + batch_size);
    const prepared = await Promise.all(batch.map(item => prepare_input(item.embed_input, max_tokens)));
    const embed_inputs = prepared.map(p => p.text);
    const tokens = prepared.map(p => p.tokens);

    try {
      const resp = await pipeline(embed_inputs, { pooling: 'mean', normalize: true });
      for (let j = 0; j < batch.length; j++) {
        const vec = Array.from(resp[j].data).map(val => Math.round(val * 1e8) / 1e8);
        results.push({ ...batch[j], vec, tokens: tokens[j] });
      }
    } catch (err) {
      for (let j = 0; j < batch.length; j++) {
        try {
          const p = await prepare_input(batch[j].embed_input, max_tokens);
          const resp = await pipeline(p.text, { pooling: 'mean', normalize: true });
          const vec = Array.from(resp[0].data).map(val => Math.round(val * 1e8) / 1e8);
          results.push({ ...batch[j], vec, tokens: p.tokens });
        } catch (single_err) {
          results.push({ ...batch[j], vec: [], tokens: 0, error: single_err.message });
        }
      }
    }
  }
  return results;
}

async function process_message(data) {
  const { method, params, id, iframe_id } = data;
  try {
    let result;
    switch (method) {
      case 'load':
        console.log('[Transformers Iframe] load', params);
        if (!pipeline || current_model_key !== params.model_key) {
          const has_gpu = await is_webgpu_available();
          await load_transformers_with_fallback(params.model_key, has_gpu);
        }
        result = { model_loaded: true };
        break;
      case 'unload':
        if (pipeline && typeof pipeline.dispose === 'function') pipeline.dispose();
        pipeline = null; tokenizer = null; current_model_key = null;
        result = { model_unloaded: true };
        break;
      case 'embed_batch':
        if (!pipeline) throw new Error('Model not loaded');
        while (processing_message) await new Promise(r => setTimeout(r, 100));
        processing_message = true;
        result = await process_batch(params.inputs, params.max_tokens || 512, params.batch_size || 8);
        processing_message = false;
        break;
      case 'count_tokens':
        if (!tokenizer) throw new Error('Tokenizer not loaded');
        while (processing_message) await new Promise(r => setTimeout(r, 100));
        processing_message = true;
        result = await count_tokens(params);
        processing_message = false;
        break;
      default:
        throw new Error('Unknown method: ' + method);
    }
    return { id, result, iframe_id };
  } catch (error) {
    return { id, error: error.message, iframe_id };
  }
}
`;

/**
 * Adapter for local Transformers.js embedding models.
 * Uses a hidden iframe with inline script (matching v3.0.80 approach).
 * The iframe shares the app://obsidian.md origin and can do dynamic
 * import() from CDN for loading @huggingface/transformers.
 */
export class TransformersEmbedAdapter {
  adapter: string = 'transformers';
  model_key: string;
  dims: number;
  models: Record<string, ModelInfo>;
  settings: any;
  loaded: boolean = false;
  iframe: HTMLIFrameElement | null = null;
  message_id: number = 0;
  pending_requests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private iframe_id: string;
  private origin: string;

  constructor(config: {
    adapter: string;
    model_key: string;
    dims: number;
    models: Record<string, ModelInfo>;
    settings: any;
    plugin_dir?: string;
    fs_adapter?: any;
  }) {
    this.adapter = config.adapter;
    this.model_key = config.model_key;
    this.dims = config.dims;
    this.models = config.models || TRANSFORMERS_EMBED_MODELS;
    this.settings = config.settings;
    this.iframe_id = `smart_embed_iframe_${Date.now()}`;
    this.origin = typeof window !== 'undefined' ? window.location.origin : '';
  }

  /**
   * Initialize the iframe and load the model.
   */
  async load(): Promise<void> {
    if (this.iframe) return;

    // Remove any existing iframe with this ID
    const existing = document.getElementById(this.iframe_id);
    if (existing) existing.remove();

    // Create hidden iframe
    this.iframe = document.createElement('iframe');
    this.iframe.style.display = 'none';
    this.iframe.id = this.iframe_id;
    document.body.appendChild(this.iframe);

    // Set up message listener on the main window
    window.addEventListener('message', this._handle_message);

    // Generate the srcdoc with inline connector script
    const srcdoc = `<html><body><script type="module">
${EMBED_CONNECTOR}
const IFRAME_ID = '${this.iframe_id}';
window.addEventListener('message', async (event) => {
  if (!event.data || event.data.iframe_id !== IFRAME_ID) return;
  const response = await process_message(event.data);
  window.parent.postMessage(response, '*');
});
console.log('[Transformers Iframe] ready, id=' + IFRAME_ID);
<\/script></body></html>`;

    this.iframe.srcdoc = srcdoc;

    // Wait for iframe to load
    await new Promise<void>((resolve) => {
      this.iframe!.onload = () => resolve();
    });

    // Load the model in the iframe
    await this.send_message('load', { model_key: this.model_key });
    this.loaded = true;
  }

  /**
   * Handle message from iframe
   */
  private _handle_message = (event: MessageEvent): void => {
    if (event.data?.iframe_id !== this.iframe_id) return;
    const { id, result, error } = event.data;
    const pending = this.pending_requests.get(id);
    if (pending) {
      this.pending_requests.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
  };

  /**
   * Send message to iframe and wait for response
   */
  private send_message(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.iframe?.contentWindow) {
        reject(new Error('Iframe not initialized'));
        return;
      }

      const id = this.message_id++;
      this.pending_requests.set(id, { resolve, reject });

      // srcdoc iframes have origin "null", so we use '*' for targetOrigin.
      // Security is ensured by the iframe_id check in _handle_message.
      this.iframe.contentWindow.postMessage(
        { id, method, params, iframe_id: this.iframe_id },
        '*'
      );
    });
  }

  /**
   * Count tokens in input text
   */
  async count_tokens(input: string): Promise<number> {
    const result = await this.send_message('count_tokens', input);
    return result.tokens;
  }

  /**
   * Generate embeddings for multiple inputs
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    const normalized_inputs = inputs
      .map((item) => {
        const embed_input = 'embed_input' in item ? item.embed_input : item._embed_input;
        return { ...item, embed_input } as EmbedInput;
      })
      .filter((item) => (item.embed_input?.length ?? 0) > 0);

    if (normalized_inputs.length === 0) {
      return [];
    }

    return await this.send_message('embed_batch', { inputs: normalized_inputs });
  }

  /**
   * Get model information
   */
  get_model_info(model_key?: string): ModelInfo | undefined {
    return this.models[model_key || this.model_key];
  }

  /**
   * Unload the model and remove iframe
   */
  async unload(): Promise<void> {
    if (this.iframe) {
      try {
        await this.send_message('unload');
      } catch (e) {
        // Iframe may already be gone
      }
      window.removeEventListener('message', this._handle_message);
      this.iframe.remove();
      this.iframe = null;
      this.pending_requests.clear();
      this.loaded = false;
    }
  }
}
