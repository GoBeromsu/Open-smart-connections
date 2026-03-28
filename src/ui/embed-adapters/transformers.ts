/**
 * @file transformers.ts
 * @description Public Transformers.js adapter facade.
 */

import type { EmbedInput, EmbedResult, ModelInfo } from '../../types/models';
import { embedAdapterRegistry } from '../../domain/embed-model';
import { build_transformers_batch_results } from './transformers-batch';
import { create_transformers_srcdoc, wait_for_iframe_load } from './transformers-iframe';
import { TRANSFORMERS_EMBED_MODELS } from './transformers-models';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timeout_id: number;
  method: string;
};

export { TRANSFORMERS_EMBED_MODELS } from './transformers-models';

export class TransformersEmbedAdapter {
  adapter = 'transformers';
  loaded = false;
  iframe: HTMLIFrameElement | null = null;
  message_id = 0;
  pending_requests = new Map<number, PendingRequest>();
  private readonly iframe_id: string;
  private static readonly MESSAGE_TIMEOUTS_MS: Record<string, number> = {
    load: 180000,
    unload: 10000,
    count_tokens: 20000,
    embed_batch: 180000,
  };

  constructor(
    public config: {
      adapter: string;
      model_key: string;
      dims: number;
      models: Record<string, ModelInfo>;
      settings: Record<string, unknown>;
      plugin_dir?: string;
      fs_adapter?: unknown;
    },
  ) {
    this.iframe_id = `smart_embed_iframe_${Date.now()}`;
  }

  get model_key(): string { return this.config.model_key; }
  get dims(): number { return this.config.dims; }
  get models(): Record<string, ModelInfo> { return this.config.models || TRANSFORMERS_EMBED_MODELS; }
  get settings(): Record<string, unknown> { return this.config.settings; }

  async load(): Promise<void> {
    if (this.iframe && this.loaded) return;
    if (this.iframe && !this.loaded) await this.unload();
    document.getElementById(this.iframe_id)?.remove();

    this.iframe = document.createElement('iframe');
    this.iframe.classList.add('osc-hidden');
    this.iframe.id = this.iframe_id;
    document.body.appendChild(this.iframe);
    window.addEventListener('message', this._handle_message);
    this.iframe.srcdoc = create_transformers_srcdoc(this.iframe_id);

    await wait_for_iframe_load(this.iframe);
    await this.send_message('load', { model_key: this.model_key });
    this.loaded = true;
  }

  async count_tokens(input: string): Promise<number> {
    const result = await this.send_message('count_tokens', input) as { tokens: number };
    return result.tokens;
  }

  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    const { results, valid_inputs, valid_indexes } = build_transformers_batch_results(inputs);
    if (valid_inputs.length === 0) return results;

    const embedded = await this.send_message('embed_batch', { inputs: valid_inputs }) as EmbedResult[];
    for (let i = 0; i < valid_indexes.length && i < embedded.length; i++) {
      const idx = valid_indexes[i];
      const embedding = embedded[i];
      if (idx === undefined || !embedding) continue;
      const result = results[idx];
      if (!result) continue;
      result.vec = embedding.vec;
      result.tokens = embedding.tokens;
      result.key = embedding.key ?? result.key;
      result.index = embedding.index ?? result.index;
    }
    return results;
  }

  get_model_info(model_key?: string): ModelInfo | undefined {
    return this.models[model_key || this.model_key];
  }

  async unload(): Promise<void> {
    if (!this.iframe) return;
    try {
      await this.send_message('unload');
    } catch {
      // iframe may already be gone
    }
    this.dispose_iframe();
  }

  private _handle_message = (event: MessageEvent): void => {
    const msg = event.data as { iframe_id?: unknown; type?: string; id?: number; error?: string; result?: unknown };
    if (msg.iframe_id !== this.iframe_id) return;
    if (msg.type === 'fatal') {
      const message = msg.error ? String(msg.error) : 'Unknown transformers iframe fatal error';
      if (typeof msg.id === 'number') {
        this.reject_pending(msg.id, new Error(`Transformers iframe fatal error: ${message}`));
      }
      this.reject_all_pending(new Error(`Transformers iframe fatal error: ${message}`));
      this.dispose_iframe();
      return;
    }

    if (typeof msg.id !== 'number') return;
    const pending = this.pending_requests.get(msg.id);
    if (!pending) return;
    this.pending_requests.delete(msg.id);
    window.clearTimeout(pending.timeout_id);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
  };

  private send_message(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.iframe?.contentWindow) {
        reject(new Error('Iframe not initialized'));
        return;
      }

      const id = this.message_id++;
      const timeout_ms = this.get_timeout_ms(method);
      const timeout_id = window.setTimeout(() => {
        this.reject_pending(id, new Error(`Timed out waiting for iframe response: method=${method}, timeoutMs=${timeout_ms}`));
        if (method === 'load') this.dispose_iframe();
      }, timeout_ms);
      this.pending_requests.set(id, { resolve, reject, timeout_id, method });
      this.iframe.contentWindow.postMessage({ id, method, params, iframe_id: this.iframe_id }, '*');
    });
  }

  private get_timeout_ms(method: string): number {
    const configured = Number(this.settings?.request_timeout_ms);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.max(1000, configured);
    }
    return TransformersEmbedAdapter.MESSAGE_TIMEOUTS_MS[method] ?? 60000;
  }

  private reject_pending(id: number, error: Error): void {
    const pending = this.pending_requests.get(id);
    if (!pending) return;
    this.pending_requests.delete(id);
    window.clearTimeout(pending.timeout_id);
    pending.reject(error);
  }

  private reject_all_pending(error: Error): void {
    for (const [id, pending] of this.pending_requests.entries()) {
      window.clearTimeout(pending.timeout_id);
      pending.reject(error);
      this.pending_requests.delete(id);
    }
  }

  private dispose_iframe(): void {
    this.reject_all_pending(new Error('Transformers iframe disposed before completing requests.'));
    window.removeEventListener('message', this._handle_message);
    this.iframe?.remove();
    this.iframe = null;
    this.loaded = false;
  }
}

embedAdapterRegistry.register({
  name: 'transformers',
  displayName: 'Local (Transformers.js)',
  AdapterClass: TransformersEmbedAdapter,
  models: TRANSFORMERS_EMBED_MODELS,
  defaultDims: 384,
  requiresApiKey: false,
  requiresHost: false,
  requiresLoad: true,
});
