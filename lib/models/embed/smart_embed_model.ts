// Copyright (c) Brian Joseph Petro

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { SmartModel } from "smart-model";
import type { SmartModelOpts, EmbedInput, ModelOption, SettingsConfigEntry } from '../types';

/**
 * SmartEmbedModel - A versatile class for handling text embeddings using various model backends
 * @extends SmartModel
 * @deprecated Use EmbeddingModels (SmartModels) collection instead
 */
export class SmartEmbedModel extends SmartModel {
  scope_name: string = 'smart_embed_model';
  static defaults: Record<string, any> = {
    adapter: 'transformers',
  };
  /**
   * Create a SmartEmbedModel instance
   * @param {SmartModelOpts} opts - Configuration options
   */
  constructor(opts: SmartModelOpts = {}) {
    super(opts);
  }
  /**
   * Count tokens in an input string
   * @param {string} input - Text to tokenize
   * @returns {Promise<{tokens: number}>} Token count result
   *
   * @example
   * ```javascript
   * const result = await model.count_tokens("Hello world");
   * console.log(result.tokens); // 2
   * ```
   */
  async count_tokens(input: string): Promise<{ tokens: number }> {
    return await this.invoke_adapter_method('count_tokens', input);
  }

  /**
   * Generate embeddings for a single input
   * @param {string|EmbedInput} input - Text or object with embed_input property
   * @returns {Promise<EmbedInput>} Embedding result
   *
   * @example
   * ```javascript
   * const result = await model.embed("Hello world");
   * console.log(result.vec); // [0.1, 0.2, ...]
   * ```
   */
  async embed(input: string | EmbedInput): Promise<EmbedInput> {
    if(typeof input === 'string') input = {embed_input: input};
    return (await this.embed_batch([input]))[0];
  }

  /**
   * Generate embeddings for multiple inputs in batch
   * @param {EmbedInput[]} inputs - Array of texts or objects with embed_input
   * @returns {Promise<EmbedInput[]>} Array of embedding results
   *
   * @example
   * ```javascript
   * const results = await model.embed_batch([
   *   { embed_input: "First text" },
   *   { embed_input: "Second text" }
   * ]);
   * ```
   */
  async embed_batch(inputs: EmbedInput[]): Promise<EmbedInput[]> {
    return await this.invoke_adapter_method('embed_batch', inputs);
  }

  /**
   * Get the current batch size based on GPU settings
   * @returns {number} Current batch size for processing
   */
  get batch_size(): number { return (this.adapter as any).batch_size || 1; }


  /**
   * Get settings configuration schema
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    const _settings_config: Record<string, SettingsConfigEntry> = {
      adapter: {
        name: 'Embedding model platform',
        type: "dropdown",
        description: "Select an embedding model platform. The default 'transformers' utilizes built-in local models.",
        options_callback: 'get_platforms_as_options',
        callback: 'adapter_changed',
        default: (this.constructor as typeof SmartEmbedModel).defaults.adapter,
      },
      ...((this.adapter as any).settings_config || {}),
    };
    return this.process_settings_config(_settings_config);
  }

  process_setting_key(key: string): string {
    return key.replace(/\[ADAPTER\]/g, this.adapter_name);
  }

  /**
   * Get available embedding model options
   * @returns {ModelOption[]} Array of model options with value and name
   */
  get_embedding_model_options(): ModelOption[] {
    return Object.entries(this.models).map(([key, model]) => ({ value: key, name: key }));
  }

  // /**
  //  * Get embedding model options including 'None' option
  //  * @returns {Array<Object>} Array of model options with value and name
  //  */
  // get_block_embedding_model_options() {
  //   const options = this.get_embedding_model_options();
  //   options.unshift({ value: 'None', name: 'None' });
  //   return options;
  // }

}
