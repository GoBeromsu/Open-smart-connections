import { SmartEmbedWorkerAdapter } from "./worker";
import { transformers_defaults, transformers_settings_config, transformers_models } from "./transformers";
import path from "path";
import type { SmartModel } from 'smart-model';
import type { AdapterDefaults, ModelInfo, SettingsConfigEntry } from '../../types';

/**
 * Adapter for running transformer models in a Web Worker
 * Combines transformer model capabilities with worker thread isolation
 * @extends SmartEmbedWorkerAdapter
 */
export class SmartEmbedTransformersWorkerAdapter extends SmartEmbedWorkerAdapter {
  static defaults: AdapterDefaults = transformers_defaults;
  /**
   * Create transformers worker adapter instance
   */
  constructor(model: SmartModel) {
    super(model);
    // Create worker using a relative path
    let rel_path: string;
    if (import.meta.url.includes('smart-embed-model')) {
      rel_path = "../connectors/transformers_worker.js";
    } else {
      rel_path = path.dirname(find_module_path("smart-embed-model")) + "/connectors/transformers_worker.js";
    }
    /** URL to worker script */
    this.worker_url = new URL(rel_path, import.meta.url);
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

import { createRequire } from "module";
const require = createRequire(import.meta.url);

/**
 * Finds and returns the absolute file system path to a node module's entry file.
 *
 * @param {string} module_name - The name of the node module to locate.
 * @returns {string} The absolute path to the module's entry file.
 * @throws {Error} If the module cannot be resolved.
 */
export function find_module_path(module_name: string): string {
  try {
    return require.resolve(module_name);
  } catch (error) {
    throw new Error("Module not found: " + module_name);
  }
}
