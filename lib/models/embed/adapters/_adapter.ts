import { SmartModelAdapter } from "smart-model/adapters/_adapter";
import type { AdapterDefaults, SettingsConfigEntry, EmbedInput } from '../../types';

/**
 * Base adapter class for embedding models
 * @abstract
 * @extends SmartModelAdapter
 */
export class SmartEmbedAdapter extends SmartModelAdapter {
  /**
   * @override in sub-class with adapter-specific default configurations
   * @property {string} id - The adapter identifier
   * @property {string} description - Human-readable description
   * @property {string} type - Adapter type ("API")
   * @property {string} endpoint - API endpoint
   * @property {string} adapter - Adapter identifier
   * @property {string} default_model - Default model to use
   */
  static defaults: AdapterDefaults = {};
  /**
   * Count tokens in input text
   * @abstract
   * @param {string} input - Text to tokenize
   * @returns {Promise<{tokens: number}>} Token count result
   * @throws {Error} If not implemented by subclass
   */
  async count_tokens(input: string): Promise<{ tokens: number }> {
    throw new Error('count_tokens method not implemented');
  }

  /**
   * Generate embeddings for single input
   * @abstract
   * @param {string|EmbedInput} input - Text to embed
   * @returns {Promise<EmbedInput>} Embedding result
   * @throws {Error} If not implemented by subclass
   */
  async embed(input: string | EmbedInput): Promise<EmbedInput> {
    if(typeof input === 'string') input = {embed_input: input};
    return (await this.embed_batch([input]))[0];
  }

  /**
   * Generate embeddings for multiple inputs
   * @abstract
   * @param {EmbedInput[]} inputs - Texts to embed
   * @returns {Promise<EmbedInput[]>} Array of embedding results
   * @throws {Error} If not implemented by subclass
   */
  async embed_batch(inputs: EmbedInput[]): Promise<EmbedInput[]> {
    throw new Error('embed_batch method not implemented');
  }

  get settings_config(): Record<string, SettingsConfigEntry> {
    return {
      "[ADAPTER].model_key": {
        name: 'Embedding model',
        type: "dropdown",
        description: "Select an embedding model.",
        options_callback: 'adapter.get_models_as_options',
        callback: 'model_changed',
        default: (this.constructor as typeof SmartEmbedAdapter).defaults.default_model,
      },
    };
  }

  get dims(): number | undefined { return this.model.data.dims; }
  get max_tokens(): number | undefined { return this.model.data.max_tokens; }

  get batch_size(): number {
    return this.model.data.batch_size || 1;
  }
}
