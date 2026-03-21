/**
 * @file embed-model.ts
 * @description EmbedAdapterRegistry (centralized adapter registration and factory) +
 * EmbedModel (base embedding model class with adapter pattern).
 * Adapter implementations (which require obsidian) are in ui/embed-adapters/.
 */

import type { EmbedInput, EmbedResult, EmbedModelAdapter, EmbedModelApiAdapter, ModelInfo } from '../../types/models';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Metadata for a registered embedding adapter.
 */
export interface AdapterRegistration {
  /** Internal adapter name (e.g., 'openai', 'upstage', 'transformers') */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /** Adapter class constructor */
  AdapterClass: new (config: any) => any;

  /** Static model catalog (empty for dynamic-model adapters like Ollama) */
  models: Record<string, ModelInfo>;

  /** Fallback embedding dimensions when model info is unavailable */
  defaultDims: number;

  /** Whether this adapter needs an API key */
  requiresApiKey: boolean;

  /** Whether this adapter needs a host URL (local servers) */
  requiresHost: boolean;

  /** Default host URL for local adapters */
  defaultHost?: string;

  /** URL where users can sign up / get an API key */
  signupUrl?: string;

  /** Whether models are discovered at runtime (Ollama, LM Studio, OpenRouter) */
  dynamicModels?: boolean;

  /** Optional async load step after construction (e.g., Transformers.js model download) */
  requiresLoad?: boolean;
}

class EmbedAdapterRegistry {
  private adapters = new Map<string, AdapterRegistration>();

  /**
   * Register an adapter. Can be called multiple times for the same name (last wins).
   */
  register(registration: AdapterRegistration): void {
    this.adapters.set(registration.name, registration);
  }

  /**
   * Get a registration by adapter name.
   */
  get(name: string): AdapterRegistration | undefined {
    return this.adapters.get(name);
  }

  /**
   * Get all registered adapter names.
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registrations.
   */
  getAll(): AdapterRegistration[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get the static model catalog for an adapter.
   */
  getModels(name: string): Record<string, ModelInfo> {
    return this.adapters.get(name)?.models ?? {};
  }

  /**
   * Factory: create an adapter instance from settings.
   * Replaces the switch statement in embedding-manager.ts.
   */
  createAdapter(
    adapterType: string,
    modelKey: string,
    adapterSettings: Record<string, any>,
  ): { adapter: EmbedModelApiAdapter; requiresLoad: boolean } {
    const reg = this.adapters.get(adapterType);
    if (!reg) {
      throw new Error(`Unknown embed adapter: ${adapterType}. Available: ${this.getAdapterNames().join(', ')}`);
    }

    const modelInfo = reg.models[modelKey];
    if (!reg.dynamicModels && !modelInfo) {
      throw new Error(`Unknown ${reg.displayName} model: ${modelKey}. Available: ${Object.keys(reg.models).join(', ')}`);
    }

    const dims = modelInfo?.dims ?? adapterSettings.dims ?? reg.defaultDims;

    console.log(`[SC][Init]   [model] Creating ${adapterType} adapter for ${modelKey} (dims=${dims})`);

    const adapter = new reg.AdapterClass({
      adapter: adapterType,
      model_key: modelKey,
      dims,
      models: reg.models,
      settings: adapterSettings,
      host: adapterSettings.host ?? reg.defaultHost,
    });

    return { adapter, requiresLoad: reg.requiresLoad ?? false };
  }

  /**
   * Get UI-ready model list for an adapter (for settings dropdowns).
   */
  getModelPickerOptions(name: string): Array<{ value: string; name: string }> {
    const reg = this.adapters.get(name);
    if (!reg) return [];

    return Object.entries(reg.models)
      .filter(([, info]) => info.model_key && info.model_name)
      .map(([key, info]) => ({
        value: key,
        name: `${info.model_name}${info.dims ? ` (${info.dims}d)` : ''}`,
      }));
  }
}

/** Singleton registry — adapters self-register on import. */
export const embedAdapterRegistry = new EmbedAdapterRegistry();

// ---------------------------------------------------------------------------
// EmbedModel
// ---------------------------------------------------------------------------

/**
 * Configuration options for EmbedModel
 */
export interface EmbedModelOptions {
  /** Adapter instance to use */
  adapter: EmbedModelAdapter;

  /** Model key/identifier */
  model_key?: string;

  /** Settings object */
  settings?: any;

  /** Additional data */
  [key: string]: any;
}

/**
 * EmbedModel - Versatile class for handling text embeddings using various model backends
 * Supports both cloud-based APIs and local transformers models
 */
export class EmbedModel {
  adapter: EmbedModelAdapter;
  model_key: string;
  settings: any;
  data: any;

  /**
   * Create an EmbedModel instance
   * @param opts - Configuration options
   */
  constructor(opts: EmbedModelOptions) {
    this.adapter = opts.adapter;
    this.model_key = opts.model_key || this.adapter.model_key;
    this.settings = opts.settings || {};
    this.data = opts;
  }

  /**
   * Generate embeddings for multiple inputs in batch
   * @param inputs - Array of texts or objects with embed_input
   * @returns Array of embedding results
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    return await this.adapter.embed_batch(inputs);
  }

  /**
   * Unload model (for local models)
   */
  async unload(): Promise<void> {
    if (this.adapter.unload) {
      await this.adapter.unload();
    }
  }
}
