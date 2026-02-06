/**
 * @file embed-worker.ts
 * @description Unified Web Worker for Transformers.js embedding models
 * Consolidates iframe and worker functionality into a single worker
 */

// Import transformers.js from CDN
declare const self: Worker;

interface EmbedInput {
  embed_input: string;
  key?: string;
  index?: number;
}

interface DeviceConfig {
  device?: string;
  dtype?: string;
  quantized: boolean;
}

const DEVICE_CONFIGS: Record<string, DeviceConfig> = {
  // WebGPU: high quality first
  webgpu_fp16: {
    device: 'webgpu',
    dtype: 'fp16',
    quantized: false,
  },
  webgpu_fp32: {
    device: 'webgpu',
    dtype: 'fp32',
    quantized: false,
  },
  // WebGPU: quantized tiers
  webgpu_q8: {
    device: 'webgpu',
    dtype: 'q8',
    quantized: true,
  },
  webgpu_q4: {
    device: 'webgpu',
    dtype: 'q4',
    quantized: true,
  },
  webgpu_q4f16: {
    device: 'webgpu',
    dtype: 'q4f16',
    quantized: true,
  },
  webgpu_bnb4: {
    device: 'webgpu',
    dtype: 'bnb4',
    quantized: true,
  },
  // WASM: quantized CPU
  wasm_q8: {
    dtype: 'q8',
    quantized: true,
  },
  wasm_q4: {
    dtype: 'q4',
    quantized: true,
  },
  // Final universal fallback: WASM CPU, dtype = auto
  wasm_auto: {
    quantized: false,
  },
};

let pipeline: any = null;
let tokenizer: any = null;
let active_config_key: string | null = null;
let has_gpu: boolean = false;
let processing_message: boolean = false;
let current_model_key: string | null = null;

/**
 * Check if WebGPU is available
 */
async function is_webgpu_available(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await (navigator as any).gpu.requestAdapter();
  if (!adapter) return false;
  return true;
}

/**
 * Load transformers pipeline with fallback strategy
 */
async function load_transformers_with_fallback(model_key: string): Promise<void> {
  const { pipeline: createPipeline, env, AutoTokenizer } = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0'
  );

  env.allowLocalModels = false;
  if (typeof env.useBrowserCache !== 'undefined') {
    env.useBrowserCache = true;
  }

  let last_error: Error | null = null;
  const CONFIG_LIST_ORDER = Object.keys(DEVICE_CONFIGS);

  for (const config of CONFIG_LIST_ORDER) {
    if (pipeline) break;
    if (config.includes('gpu') && !has_gpu) {
      console.warn(`[Transformers Worker: ${config}] skipping GPU config as GPU is disabled`);
      continue;
    }

    try {
      console.log(`[Transformers Worker] trying to load pipeline on ${config}`);
      pipeline = await createPipeline('feature-extraction', model_key, DEVICE_CONFIGS[config] as any);
      active_config_key = config;
      break;
    } catch (err: any) {
      console.warn(`[Transformers Worker: ${config}] failed to load pipeline`, err);
      last_error = err;
    }
  }

  if (pipeline) {
    console.log(`[Transformers Worker: ${active_config_key}] pipeline initialized`);
  } else {
    throw last_error || new Error('Failed to initialize transformers pipeline');
  }

  tokenizer = await AutoTokenizer.from_pretrained(model_key);
  current_model_key = model_key;
}

/**
 * Count tokens in input text
 */
async function count_tokens(input: string): Promise<{ tokens: number }> {
  if (!tokenizer) {
    throw new Error('Tokenizer not loaded');
  }
  const { input_ids } = await tokenizer(input);
  return { tokens: input_ids.data.length };
}

/**
 * Prepare input by truncating to max_tokens if necessary
 */
async function prepare_input(
  embed_input: string,
  max_tokens: number,
): Promise<{ text: string; tokens: number }> {
  let { tokens } = await count_tokens(embed_input);
  if (tokens <= max_tokens) {
    return { text: embed_input, tokens };
  }

  let truncated = embed_input;
  while (tokens > max_tokens && truncated.length > 0) {
    const pct = max_tokens / tokens;
    const max_chars = Math.floor(truncated.length * pct * 0.9);
    truncated = truncated.slice(0, max_chars);
    const last_space = truncated.lastIndexOf(' ');
    if (last_space > 0) {
      truncated = truncated.slice(0, last_space);
    }
    tokens = (await count_tokens(truncated)).tokens;
  }
  return { text: truncated, tokens };
}

/**
 * Process a batch of inputs
 */
async function process_batch(inputs: EmbedInput[], max_tokens: number, batch_size: number): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < inputs.length; i += batch_size) {
    const batch = inputs.slice(i, i + batch_size);
    const prepared = await Promise.all(
      batch.map((item) => prepare_input(item.embed_input, max_tokens)),
    );
    const embed_inputs = prepared.map((p) => p.text);
    const tokens = prepared.map((p) => p.tokens);

    try {
      const resp = await pipeline(embed_inputs, { pooling: 'mean', normalize: true });
      for (let j = 0; j < batch.length; j++) {
        const vec = Array.from(resp[j].data).map((val: number) => Math.round(val * 1e8) / 1e8);
        results.push({
          ...batch[j],
          vec,
          tokens: tokens[j],
        });
      }
    } catch (err) {
      console.error('[Transformers Worker] batch embed failed - retrying items individually', err);
      // Retry items individually
      for (let j = 0; j < batch.length; j++) {
        try {
          const prepared = await prepare_input(batch[j].embed_input, max_tokens);
          const resp = await pipeline(prepared.text, { pooling: 'mean', normalize: true });
          const vec = Array.from(resp[0].data).map((val: number) => Math.round(val * 1e8) / 1e8);
          results.push({
            ...batch[j],
            vec,
            tokens: prepared.tokens,
          });
        } catch (single_err: any) {
          console.error('[Transformers Worker] single item embed failed - skipping', single_err);
          results.push({
            ...batch[j],
            vec: [],
            tokens: 0,
            error: single_err.message,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Process incoming messages
 */
async function process_message(data: any): Promise<any> {
  const { method, params, id } = data;

  try {
    let result: any;

    switch (method) {
      case 'load':
        console.log('[Transformers Worker] load', params);
        if (!pipeline || current_model_key !== params.model_key) {
          has_gpu = await is_webgpu_available();
          await load_transformers_with_fallback(params.model_key);
        }
        result = { model_loaded: true };
        break;

      case 'unload':
        console.log('[Transformers Worker] unload');
        if (pipeline) {
          if (typeof pipeline.destroy === 'function') {
            pipeline.destroy();
          } else if (typeof pipeline.dispose === 'function') {
            pipeline.dispose();
          }
        }
        pipeline = null;
        tokenizer = null;
        active_config_key = null;
        current_model_key = null;
        result = { model_unloaded: true };
        break;

      case 'embed_batch':
        if (!pipeline) throw new Error('Model not loaded');
        if (processing_message) {
          while (processing_message) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        processing_message = true;
        const max_tokens = params.max_tokens || 512;
        const batch_size = params.batch_size || 8;
        result = await process_batch(params.inputs, max_tokens, batch_size);
        processing_message = false;
        break;

      case 'count_tokens':
        if (!tokenizer) throw new Error('Tokenizer not loaded');
        if (processing_message) {
          while (processing_message) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        processing_message = true;
        result = await count_tokens(params);
        processing_message = false;
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    return { id, result };
  } catch (error: any) {
    console.error('[Transformers Worker] Error processing message:', error);
    return { id, error: error.message };
  }
}

// Listen for messages
self.addEventListener('message', async (event) => {
  const response = await process_message(event.data);
  self.postMessage(response);
});

console.log('[Transformers Worker] Worker loaded');
