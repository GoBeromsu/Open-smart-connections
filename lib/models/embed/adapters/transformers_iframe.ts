import { SmartEmbedIframeAdapter } from "./iframe";
import { transformers_connector } from "../connectors/transformers_iframe";
import {
  transformers_defaults,
  transformers_settings_config, // DEPRECATED
  transformers_models,
  settings_config
} from "./transformers";
import type { SmartModel } from 'smart-model';
import type { AdapterDefaults, ModelInfo, SettingsConfigEntry } from '../../types';

/**
 * Adapter for running transformer models in an iframe
 * Combines transformer model capabilities with iframe isolation
 * @extends SmartEmbedIframeAdapter
 */
export class SmartEmbedTransformersIframeAdapter extends SmartEmbedIframeAdapter {
  static defaults: AdapterDefaults = transformers_defaults;
  /**
   * Create transformers iframe adapter instance
   */
  constructor(model: SmartModel) {
    super(model);
    /** Connector script content */
    this.connector = transformers_connector
      .replace('@huggingface/transformers', 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0')
    ;
    console.log('transformers iframe connector', this.model);
  }

  /** @returns {Record<string, SettingsConfigEntry>} Settings configuration for transformers adapter */
  get settings_config(): Record<string, SettingsConfigEntry> {
    return {
      ...super.settings_config,
      ...transformers_settings_config
    };
  }
  /**
   * Get available models (hardcoded list)
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects
   */
  get_models(): Promise<Record<string, ModelInfo>> { return Promise.resolve(this.models); }
  get models(): Record<string, ModelInfo> {
    return transformers_models;
  }
}
export { settings_config };
export default {
  class: SmartEmbedTransformersIframeAdapter,
  settings_config,
}
