export const EMBED_CONNECTOR = `
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
  if (typeof env.useBrowserCache !== 'undefined') env.useBrowserCache = true;

  const configs = use_gpu ? [
    { device: 'webgpu', dtype: 'fp32', quantized: false },
    { device: 'webgpu', dtype: 'q8', quantized: true },
    { quantized: true },
    { quantized: false }
  ] : [{ quantized: true }, { quantized: false }];

  if (!use_gpu && env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = 8;
  }

  let last_error = null;
  for (const config of configs) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        pipeline = await createPipeline('feature-extraction', model_key, config);
        break;
      } catch (err) {
        last_error = err;
        const message = (err && err.message) ? String(err.message) : String(err);
        const lc = message.toLowerCase();
        const is_transient = message.includes('Failed to fetch') || lc.includes('networkerror') || lc.includes('cdn') || lc.includes('cors') || lc.includes('err_connection');
        if (attempt < MAX_ATTEMPTS && is_transient) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
          continue;
        }
      }
    }
    if (pipeline) break;
  }

  if (!pipeline) {
    const last_message = (last_error && last_error.message) ? String(last_error.message) : String(last_error || '');
    if (last_message.toLowerCase().includes('timed out') || last_message.toLowerCase().includes('timeout')) throw new Error('[download:timeout] Model download timed out. Try a smaller model or increase timeout in settings.');
    if (last_message.toLowerCase().includes('quota') || last_message.toLowerCase().includes('storage')) throw new Error('[download:quota] Browser storage quota exceeded. Clear browser cache and retry.');
    if (last_message.includes('Failed to fetch') || last_message.toLowerCase().includes('network')) throw new Error('[download:network] Failed to download model files. Check your network connection and retry.');
    if (last_message.includes('404') || last_message.toLowerCase().includes('not found')) throw new Error('[download:model_not_found] Model not found. Try switching to BGE-micro-v2.');
    throw last_error || new Error('[download:unknown] Failed to initialize transformers pipeline');
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
        if (!pipeline || current_model_key !== params.model_key) {
          await load_transformers_with_fallback(params.model_key, await is_webgpu_available());
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
