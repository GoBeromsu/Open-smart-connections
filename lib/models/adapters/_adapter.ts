import type { AdapterState, AdapterDefaults, AuthHeaderOpts, ModelInfo, ModelOption } from '../types';
import type { SmartModel } from '../smart_model';

/**
 * Base adapter class for SmartModel implementations.
 * Provides core functionality for state management and settings access.
 *
 * @abstract
 * @class SmartModelAdapter
 */
export class SmartModelAdapter {
  model: SmartModel;
  state: AdapterState;

  static defaults: AdapterDefaults = {};
  static models_dev_key?: string;
  static key?: string;

  /**
   * Create a SmartModelAdapter instance.
   * @param {SmartModel} model - The parent SmartModel instance
   */
  constructor(model: SmartModel) {
    this.model = model;
    this.state = 'unloaded';
  }

  /**
   * Load the adapter.
   * @async
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    this.set_state('loaded');
  }

  /**
   * Unload the adapter.
   * @returns {void}
   */
  unload(): void {
    this.set_state('unloaded');
  }

  /**
   * Get all settings.
   * @returns {Record<string, any>} All settings
   */
  get settings(): Record<string, any> { return this.model.settings; }

  /**
   * Provider/adapter identifier.
   * @returns {string}
   */
  get provider(): string { return this.model.adapter_name; }

  /**
   * Provider key used for caches and external model registries.
   * @returns {string}
   */
  get provider_key(): string {
    return (this.constructor as typeof SmartModelAdapter).models_dev_key
      || (this.constructor as typeof SmartModelAdapter).key
      || this.provider;
  }

  /**
   * API key resolved by the parent SmartModel.
   * @returns {string|undefined}
   */
  get api_key(): string | undefined { return this.model.api_key; }

  /**
   * Get the current model key.
   * @returns {string} Current model identifier
   */
  get model_key(): string | undefined { return this.model.model_key; }

  /**
   * Get the models.
   * @returns {Record<string, ModelInfo>} Map of model objects
   */
  get models(): Record<string, ModelInfo> {
    const models = this.model.data?.provider_models;
    if(
      typeof models === 'object'
      && Object.keys(models || {}).length > 0
    ) return models!;
    else {
      return {};
    }
  }

  /**
   * Get available models from the API.
   * @abstract
   * @param {boolean} [refresh=false] - Whether to refresh cached models
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    throw new Error("get_models not implemented");
  }

  /**
   * Build request headers with optional API-key auth handling.
   */
  build_auth_headers({
    headers = {},
    api_key = this.api_key,
    api_key_header,
    warn_missing_api_key = false,
    auth_scheme = 'Bearer',
  }: AuthHeaderOpts = {}): Record<string, string> {
    const output: Record<string, string> = { ...headers };
    if (api_key_header === 'none') {
      return output;
    }
    if (!api_key) {
      if (warn_missing_api_key) {
        console.warn('API key not set, Authorization header will be skipped');
      }
      return output;
    }
    if (api_key_header) {
      output[api_key_header] = api_key;
      return output;
    }
    output.Authorization = auth_scheme ? `${auth_scheme} ${api_key}` : api_key;
    return output;
  }
  /**
   * Get available models as dropdown options synchronously.
   * @returns {ModelOption[]} Array of model options.
   */
  get_models_as_options(): ModelOption[] {
    const models = this.models;
    if(!Object.keys(models || {}).length){
      this.get_models(true); // refresh models
      return [{value: '', name: 'No models currently available'}];
    }
    return Object.entries(models).map(([id, model]) => ({ value: id, name: model.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Set the adapter's state.
   * @deprecated should be handled in SmartModel (only handle once)
   * @param {AdapterState} new_state - The new state
   * @throws {Error} If the state is invalid
   */
  set_state(new_state: AdapterState): void {
    const valid_states: AdapterState[] = ['unloaded', 'loading', 'loaded', 'unloading'];
    if (!valid_states.includes(new_state)) {
      throw new Error(`Invalid state: ${new_state}`);
    }
    this.state = new_state;
  }
  // Replace individual state getters/setters with a unified state management
  get is_loading(): boolean { return this.state === 'loading'; }
  get is_loaded(): boolean { return this.state === 'loaded'; }
  get is_unloading(): boolean { return this.state === 'unloading'; }
  get is_unloaded(): boolean { return this.state === 'unloaded'; }
}
