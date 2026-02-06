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

import type { AdapterState, SmartModelOpts, AdapterDefaults, ModelInfo, ModelOption, SettingsConfigEntry } from './types';
import type { SmartModelAdapter } from './adapters/_adapter';

/**
 * Base model class that provides adapter management and configuration functionality.
 * Handles state transitions, adapter loading/unloading, and settings management.
 *
 * @class SmartModel
 * @deprecated Use SmartModels collection instead.
 */
export class SmartModel {
  scope_name: string = 'smart_model';
  opts: SmartModelOpts;
  state: AdapterState;
  _adapter: SmartModelAdapter | null;
  data: SmartModelOpts;
  reload_model_timeout: ReturnType<typeof setTimeout> | null = null;
  env?: any;
  notices?: any;

  static defaults: Record<string, any> = {
    // override in sub-class if needed
  };
  /**
   * Create a SmartModel instance.
   * @param {SmartModelOpts} opts - Configuration options
   * @throws {Error} If required options are missing
   */
  constructor(opts: SmartModelOpts = {}) {
    this.opts = opts;
    this.validate_opts(opts);
    this.state = 'unloaded';
    this._adapter = null;
    // connector backwards compatibility
    this.data = opts;
  }

  /**
   * Initialize the model by loading the configured adapter.
   * @async
   * @returns {Promise<void>}
   */
  async initialize(): Promise<void> {
    this.load_adapter(this.adapter_name);
    await this.load();
  }

  /**
   * Validate required options.
   * @param {SmartModelOpts} opts - Configuration options
   */
  validate_opts(opts: SmartModelOpts): void {
    if (!opts.adapters) throw new Error("opts.adapters is required");
    if (!opts.settings) throw new Error("opts.settings is required");
  }

  /**
   * Get the current settings
   * @returns {Record<string, any>} Current settings
   */
  get settings(): Record<string, any> {
    if(!this.opts.settings) this.opts.settings = {
      ...(this.constructor as typeof SmartModel).defaults,
    };
    return this.opts.settings!;
  }

  /**
   * Get the current adapter name
   * @returns {string} Current adapter name
   */
  get adapter_name(): string {
    let adapter_key = this.opts.adapter
      || this.settings.adapter
      || Object.keys(this.adapters)[0]
    ;
    if(!adapter_key || !this.adapters[adapter_key]){
      console.warn(`Platform "${adapter_key}" not supported`);
      adapter_key = Object.keys(this.adapters)[0];
    }
    return adapter_key;
  }

  /**
   * Get available models.
   * @returns {Record<string, ModelInfo>} Map of model objects
   */
  get models(): Record<string, ModelInfo> { return this.adapter.models; }

  /**
   * Get default model key.
   * @returns {string|undefined} Default model key
   */
  get default_model_key(): string | undefined {
    return (this.adapter.constructor as typeof SmartModelAdapter).defaults.default_model;
  }

  /**
   * Get the current model key
   * @returns {string|undefined} Current model key
   */
  get model_key(): string | undefined {
    return this.opts.model_key // directly passed opts take precedence
      || this.settings.model_key // then settings
      || this.default_model_key // then default
    ;
  }

  /**
   * Get the API key for the current adapter.
   * @returns {string|undefined} API key
   */
  get api_key(): string | undefined {
    return this.settings?.[this.adapter_name]?.api_key
      || this.settings?.api_key // deprecated global setting support
      || this.opts?.api_key // deprecated constructor-level support
    ;
  }

  /**
   * Load the current adapter and transition to loaded state.
   * @async
   * @returns {Promise<void>}
   */
  async load(): Promise<void> {
    this.set_state('loading');
    try {
      if (!this.adapter?.is_loaded) {
        await this.invoke_adapter_method('load');
      }
    } catch (err: any) {
      this.set_state('unloaded');

      // try to reload once per minute
      if(!this.reload_model_timeout) {
        this.reload_model_timeout = setTimeout(async () => {
          this.reload_model_timeout = null;
          await this.load();
          this.set_state('loaded');
          this.env?.events?.emit('model:loaded', { model_key: this.model_key });
          this.notices?.show('Loaded model: ' + this.model_key);
        }, 60000);
      }
      throw new Error(`Failed to load model: ${err.message}`);
    }
    this.set_state('loaded');
  }

  /**
   * Unload the current adapter and transition to unloaded state.
   * @async
   * @returns {Promise<void>}
   */
  async unload(): Promise<void> {
    if (this.adapter?.is_loaded) {
      this.set_state('unloading');
      await this.invoke_adapter_method('unload');
      this.set_state('unloaded');
    }
  }

  /**
   * Set the model's state.
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
  get is_loading(): boolean { return this.state === 'loading'; }
  get is_loaded(): boolean { return this.state === 'loaded'; }
  get is_unloading(): boolean { return this.state === 'unloading'; }
  get is_unloaded(): boolean { return this.state === 'unloaded'; }


  // ADAPTERS
  /**
   * Get the map of available adapters
   * @returns {Record<string, new (model: any) => SmartModelAdapter>} Map of adapter names to adapter classes
   */
  get adapters(): Record<string, new (model: any) => SmartModelAdapter> { return this.opts.adapters || {}; }

  /**
   * Load a specific adapter by name.
   * @async
   * @param {string} adapter_name - Name of the adapter to load
   * @throws {Error} If adapter not found or loading fails
   * @returns {Promise<void>}
   */
  async load_adapter(adapter_name: string): Promise<void> {
    this.set_adapter(adapter_name);
    if (!this._adapter!.is_loaded) {
        this.set_state('loading');
        try {
            await this.invoke_adapter_method('load');
            this.set_state('loaded');
        } catch (err: any) {
            this.set_state('unloaded');
            throw new Error(`Failed to load adapter: ${err.message}`);
        }
    }
  }

  /**
   * Set an adapter instance by name without loading it.
   * @param {string} adapter_name - Name of the adapter to set
   * @throws {Error} If adapter not found
   */
  set_adapter(adapter_name: string): void {
    const AdapterClass = this.adapters[adapter_name];
    if (!AdapterClass) {
        throw new Error(`Adapter "${adapter_name}" not found.`);
    }
    if (this._adapter?.constructor.name.toLowerCase() === adapter_name.toLowerCase()) {
        return; // Adapter already set
    }
    this._adapter = new AdapterClass(this);
  }

  /**
   * Get the current active adapter instance
   * @returns {SmartModelAdapter} The active adapter instance
   * @throws {Error} If adapter not found
   */
  get adapter(): SmartModelAdapter {
    const adapter_name = this.adapter_name;
    if (!adapter_name) {
      throw new Error(`Adapter not set for model.`);
    }
    if (!this._adapter) {
      this.load_adapter(adapter_name);
    }
    return this._adapter!;
  }

  /**
   * Ensure the adapter is ready to execute a method.
   * @param {string} method - Name of the method to check
   * @throws {Error} If adapter not loaded or method not implemented
   */
  ensure_adapter_ready(method: string): void {
    if (!this.adapter) {
      throw new Error('No adapter loaded.');
    }
    if (typeof (this.adapter as any)[method] !== 'function') {
      throw new Error(`Adapter does not implement method: ${method}`);
    }
  }

  /**
   * Invoke a method on the current adapter.
   * @async
   * @param {string} method - Name of the method to call
   * @param {...any} args - Arguments to pass to the method
   * @returns {Promise<any>} Result from the adapter method
   * @throws {Error} If adapter not ready or method fails
   */
  async invoke_adapter_method(method: string, ...args: any[]): Promise<any> {
    this.ensure_adapter_ready(method);
    return await (this.adapter as any)[method](...args);
  }



  /**
   * Get platforms as dropdown options.
   * @returns {ModelOption[]} Array of {value, name} option objects
   */
  get_platforms_as_options(): ModelOption[] {
    return Object.entries(this.adapters).map(([key, AdapterClass]) => ({ value: key, name: (AdapterClass as any).defaults?.description || key }));
  }


  // SETTINGS
  /**
   * Get the settings configuration schema
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    return this.process_settings_config({
      adapter: {
        name: 'Model Platform',
        type: "dropdown",
        description: "Select a model platform to use with Smart Model.",
        options_callback: 'get_platforms_as_options',
        is_scope: true, // trigger re-render of settings when changed
        callback: 'adapter_changed',
        default: 'default',
      },
    });
  }

  /**
   * Process settings configuration with conditionals and prefixes.
   * @param {Record<string, SettingsConfigEntry>} _settings_config - Raw settings configuration
   * @param {string|null} [prefix] - Optional prefix for setting keys
   * @returns {Record<string, SettingsConfigEntry>} Processed settings configuration
   */
  process_settings_config(_settings_config: Record<string, SettingsConfigEntry>, prefix: string | null = null): Record<string, SettingsConfigEntry> {
    return Object.entries(_settings_config)
      .reduce((acc: Record<string, SettingsConfigEntry>, [key, val]) => {
        const new_key = (prefix ? prefix + "." : "") + this.process_setting_key(key);
        acc[new_key] = val;
        return acc;
      }, {})
    ;
  }

  /**
   * Process an individual setting key.
   * @param {string} key - The setting key with placeholders.
   * @returns {string} Processed setting key.
   */
  process_setting_key(key: string): string {
    return key.replace(/\[ADAPTER\]/g, this.adapter_name);
  }

  re_render_settings(): void {
    if(typeof this.opts.re_render_settings === 'function') this.opts.re_render_settings();
    else console.warn('re_render_settings is not a function (must be passed in model opts)');
  }
  /**
   * Reload model.
   */
  reload_model(): void {
    if(typeof this.opts.reload_model === 'function') this.opts.reload_model();
    else console.warn('reload_model is not a function (must be passed in model opts)');
  }
  adapter_changed(): void {
    this.reload_model();
    this.re_render_settings();
  }
  model_changed(): void {
    this.reload_model();
    this.re_render_settings();
  }

}
