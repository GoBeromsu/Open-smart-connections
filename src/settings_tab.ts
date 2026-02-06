import { PluginSettingTab, Setting, Notice, App, Plugin } from 'obsidian';

interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  dims?: number;
  max_tokens?: number;
  batch_size?: number;
  adapter?: string;
}

interface SmartEmbedModelInstance {
  adapter_name: string;
  adapter: any;
  loaded: boolean;
  get_platforms_as_options(): Array<{ value: string; name: string }>;
  adapter_changed(): void;
  model_changed(): void;
  re_render_settings(): void;
  opts: { re_render_settings?: () => void };
  adapters: Record<string, any>;
}

interface OscPlugin extends Plugin {
  env?: {
    settings?: any;
    save_settings?: () => void;
    embedding_models?: { default?: { instance?: SmartEmbedModelInstance } };
    smart_sources?: any;
    force_refresh?: () => Promise<void>;
  };
}

export class OscSettingsTab extends PluginSettingTab {
  plugin: OscPlugin;

  constructor(app: App, plugin: OscPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Resolve the SmartEmbedModel instance from env.embedding_models */
  private get embedModel(): SmartEmbedModelInstance | undefined {
    return this.plugin.env?.embedding_models?.default?.instance as SmartEmbedModelInstance | undefined;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('osc-settings');

    // Wire up re_render_settings callback
    const model = this.embedModel;
    if (model) {
      model.opts.re_render_settings = () => this.display();
    }

    // ── Embedding Model ──
    new Setting(containerEl).setName('Embedding Model').setHeading();

    this.renderEmbeddingModelSection(containerEl);

    // ── Source Settings ──
    new Setting(containerEl).setName('Source Settings').setHeading();

    new Setting(containerEl)
      .setName('Minimum characters')
      .setDesc('Skip files shorter than this character count')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.getConfig('smart_sources.min_chars', 200)));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.min_chars', parseInt(value) || 200);
        });
      });

    new Setting(containerEl)
      .setName('File exclusions')
      .setDesc('Comma-separated file name patterns to exclude')
      .addText(text => {
        text.setPlaceholder('Untitled, Templates');
        text.setValue(this.getConfig('smart_sources.file_exclusions', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.file_exclusions', value);
        });
      });

    new Setting(containerEl)
      .setName('Folder exclusions')
      .setDesc('Comma-separated folder paths to exclude')
      .addText(text => {
        text.setPlaceholder('archive/, templates/');
        text.setValue(this.getConfig('smart_sources.folder_exclusions', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.folder_exclusions', value);
        });
      });

    new Setting(containerEl)
      .setName('Excluded headings')
      .setDesc('Comma-separated heading patterns to skip')
      .addText(text => {
        text.setPlaceholder('#draft, #ignore');
        text.setValue(this.getConfig('smart_sources.excluded_headings', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.excluded_headings', value);
        });
      });

    // ── Block Settings ──
    new Setting(containerEl).setName('Block Settings').setHeading();

    new Setting(containerEl)
      .setName('Enable block-level embedding')
      .setDesc('Embed individual sections for more granular connections')
      .addToggle(toggle => {
        toggle.setValue(this.getConfig('smart_blocks.embed_blocks', true));
        toggle.onChange(async (value) => {
          this.setConfig('smart_blocks.embed_blocks', value);
        });
      });

    new Setting(containerEl)
      .setName('Minimum block characters')
      .setDesc('Skip blocks shorter than this character count')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.getConfig('smart_blocks.min_chars', 200)));
        text.onChange(async (value) => {
          this.setConfig('smart_blocks.min_chars', parseInt(value) || 200);
        });
      });

    // ── View Settings ──
    new Setting(containerEl).setName('View Settings').setHeading();

    new Setting(containerEl)
      .setName('Results limit')
      .setDesc('Maximum number of connections to display')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.getConfig('smart_view_filter.results_limit', 20)));
        text.onChange(async (value) => {
          this.setConfig('smart_view_filter.results_limit', parseInt(value) || 20);
        });
      });

    new Setting(containerEl)
      .setName('Show full path')
      .setDesc('Display folder path in result titles')
      .addToggle(toggle => {
        toggle.setValue(this.getConfig('smart_view_filter.show_full_path', false));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.show_full_path', value);
        });
      });

    new Setting(containerEl)
      .setName('Exclude inlinks')
      .setDesc('Hide notes that link to the current note')
      .addToggle(toggle => {
        toggle.setValue(this.getConfig('smart_view_filter.exclude_inlinks', false));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.exclude_inlinks', value);
        });
      });

    new Setting(containerEl)
      .setName('Exclude outlinks')
      .setDesc('Hide notes linked from the current note')
      .addToggle(toggle => {
        toggle.setValue(this.getConfig('smart_view_filter.exclude_outlinks', false));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.exclude_outlinks', value);
        });
      });

    new Setting(containerEl)
      .setName('Render markdown in preview')
      .setDesc('Render markdown formatting in hover previews')
      .addToggle(toggle => {
        toggle.setValue(this.getConfig('smart_view_filter.render_markdown', true));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.render_markdown', value);
        });
      });

    // ── Embedding Status ──
    new Setting(containerEl).setName('Embedding Status').setHeading();
    this.renderEmbeddingStatus(containerEl);
  }

  private renderEmbeddingModelSection(containerEl: HTMLElement): void {
    const model = this.embedModel;
    if (!model) {
      containerEl.createDiv({ text: 'Embedding model not initialized', cls: 'osc-error' });
      return;
    }

    const currentAdapter = this.getConfig('smart_sources.embed_model.adapter', 'transformers');
    const platforms = model.get_platforms_as_options();

    // Provider dropdown
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Embedding model provider')
      .addDropdown(dropdown => {
        platforms.forEach(platform => {
          dropdown.addOption(platform.value, platform.name);
        });
        dropdown.setValue(currentAdapter);
        dropdown.onChange(async (value) => {
          await this.handleProviderChange(value);
        });
      });

    // Get current adapter instance
    const adapter: any = model.adapter;
    const adapterName = model.adapter_name;

    // Model dropdown
    this.renderModelDropdown(containerEl, adapter, adapterName);

    // API Key field (conditional) — adapter uses [ADAPTER].api_key in settings_config
    const settingsConfig = adapter?.settings_config || {};
    const hasApiKey = Object.keys(settingsConfig).some((k: string) => k.endsWith('.api_key'));
    if (hasApiKey) {
      this.renderApiKeyField(containerEl, adapterName);
    }

    // Host URL field (conditional) — check static defaults on adapter constructor
    const adapterDefaults = (adapter?.constructor as any)?.defaults || {};
    if (adapterDefaults.host) {
      this.renderHostField(containerEl, adapterName, adapterDefaults.host);
    }

    // Model status
    this.renderModelStatus(containerEl);
  }

  private renderModelDropdown(
    containerEl: HTMLElement,
    adapter: any,
    adapterName: string,
  ): void {
    const modelSetting = new Setting(containerEl)
      .setName('Model')
      .setDesc('Embedding model to use');

    // Dynamic adapters have a models_endpoint in their static defaults
    const adapterDefaults = (adapter?.constructor as any)?.defaults || {};
    const isDynamic = !!adapterDefaults.models_endpoint;

    // Use cached/static models synchronously; dynamic adapters populate cache on load
    // and call re_render_settings() which triggers display() again
    let models: Record<string, ModelInfo> = {};

    if (adapter?.models && Object.keys(adapter.models).length > 0) {
      models = adapter.models;
    } else if (adapter?.model?.data?.provider_models) {
      models = adapter.model.data.provider_models;
    }

    // If no models cached yet for dynamic adapter, kick off async fetch
    if (isDynamic && Object.keys(models).length === 0) {
      adapter.get_models().catch((err: any) => {
        console.warn('Failed to fetch embed models:', err);
      });
    }

    const currentModelKey = this.getConfig(
      `smart_sources.embed_model.${adapterName}.model_key`,
      '',
    );

    modelSetting.addDropdown(dropdown => {
      const modelEntries = Object.entries(models);
      if (modelEntries.length === 0) {
        dropdown.addOption('', isDynamic ? 'Fetching models...' : 'No models available');
      } else {
        modelEntries.forEach(([id, info]) => {
          const displayName = info.name || info.description || id;
          dropdown.addOption(id, displayName);
        });
      }

      if (currentModelKey) {
        dropdown.setValue(currentModelKey);
      }

      dropdown.onChange(async (value) => {
        await this.handleModelChange(value, models, adapterName);
      });
    });

    // Add refresh button for dynamic adapters
    if (isDynamic) {
      modelSetting.addButton(btn => {
        btn
          .setButtonText('Refresh')
          .setTooltip('Refresh available models')
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await adapter.get_models(true);
            } catch (error: any) {
              new Notice(`Failed to refresh models: ${error.message}`);
            }
            btn.setDisabled(false);
          });
      });
    }
  }

  private renderApiKeyField(
    containerEl: HTMLElement,
    adapterName: string,
  ): void {
    const currentApiKey = this.getConfig(
      `smart_sources.embed_model.${adapterName}.api_key`,
      '',
    );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('API key for authentication')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Enter API key');
        text.setValue(currentApiKey);
        text.onChange(async (value) => {
          this.setConfig(`smart_sources.embed_model.${adapterName}.api_key`, value);
        });
      });
  }

  private renderHostField(
    containerEl: HTMLElement,
    adapterName: string,
    defaultHost: string,
  ): void {
    const currentHost = this.getConfig(
      `smart_sources.embed_model.${adapterName}.host`,
      defaultHost,
    );

    new Setting(containerEl)
      .setName('Host URL')
      .setDesc('API endpoint URL')
      .addText(text => {
        text.setPlaceholder(defaultHost);
        text.setValue(currentHost);
        text.onChange(async (value) => {
          this.setConfig(`smart_sources.embed_model.${adapterName}.host`, value);
        });
      });
  }

  private async handleProviderChange(newProvider: string): Promise<void> {
    const env = this.plugin.env;
    if (!env?.settings || !this.embedModel) return;

    // Write new adapter to settings
    this.setConfig('smart_sources.embed_model.adapter', newProvider);

    // Trigger adapter change
    this.embedModel!.adapter_changed();

    // Re-render settings
    this.display();
  }

  private async handleModelChange(
    newModelKey: string,
    models: Record<string, ModelInfo>,
    adapterName: string,
  ): Promise<void> {
    const env = this.plugin.env;
    if (!env?.settings || !this.embedModel) return;

    // Get old and new model info
    const oldModelKey = this.getConfig(
      `smart_sources.embed_model.${adapterName}.model_key`,
      '',
    );
    const oldModel = models[oldModelKey];
    const newModel = models[newModelKey];

    const oldDims = oldModel?.dims;
    const newDims = newModel?.dims;

    // Write new model key to settings
    this.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, newModelKey);

    // Check if dimensions changed
    const dimsChanged = oldDims !== undefined && newDims !== undefined && oldDims !== newDims;

    if (dimsChanged) {
      new Notice(
        `Embedding dimensions changed (${oldDims} → ${newDims}). Re-embedding all notes...`,
      );
    }

    // Trigger model change
    this.embedModel!.model_changed();

    // If dimensions changed, trigger re-embedding
    if (dimsChanged) {
      try {
        await env.smart_sources?.process_source_import_queue?.({ force: true });
      } catch (error: any) {
        new Notice(`Re-embedding failed: ${error.message}`);
      }
    }
  }

  private renderModelStatus(containerEl: HTMLElement): void {
    const statusEl = containerEl.createDiv({ cls: 'osc-model-status' });
    const model = this.embedModel as any;
    if (model?.model_loaded || model?.state === 'loaded') {
      statusEl.createSpan({ cls: 'osc-status-dot osc-status-dot--ready' });
      statusEl.createSpan({ text: 'Ready', cls: 'osc-status-text' });
    } else {
      statusEl.createSpan({ cls: 'osc-status-dot osc-status-dot--loading' });
      statusEl.createSpan({ text: 'Loading model...', cls: 'osc-status-text' });
    }
  }

  private renderEmbeddingStatus(containerEl: HTMLElement): void {
    const env = this.plugin.env;
    const sources = env?.smart_sources;

    const total = sources?.keys?.length ?? 0;
    const embedded = sources?.embedded_items?.length
      ?? sources?.keys?.filter((k: string) => sources.get(k)?.vec)?.length
      ?? 0;
    const pending = total - embedded;
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;

    // Stats grid
    const grid = containerEl.createDiv({ cls: 'osc-stats-grid' });
    this.createStatCard(grid, 'Total sources', String(total));
    this.createStatCard(grid, 'Embedded', String(embedded), 'osc-stat--green');
    this.createStatCard(grid, 'Pending', String(pending), pending > 0 ? 'osc-stat--amber' : '');
    this.createStatCard(grid, 'Progress', `${pct}%`);

    // Progress bar
    const track = containerEl.createDiv({ cls: 'osc-progress-track osc-progress-track--settings' });
    const fill = track.createDiv({ cls: 'osc-progress-fill' });
    fill.style.width = `${pct}%`;

    // Actions
    new Setting(containerEl)
      .addButton(btn => {
        btn.setButtonText('Re-embed All')
          .setWarning()
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await env?.force_refresh?.();
            } catch (e) {
              // handle silently
            }
            btn.setDisabled(false);
            this.display();
          });
      });
  }

  private createStatCard(parent: HTMLElement, label: string, value: string, cls = ''): void {
    const card = parent.createDiv({ cls: `osc-stat-card ${cls}`.trim() });
    card.createDiv({ text: value, cls: 'osc-stat-value' });
    card.createDiv({ text: label, cls: 'osc-stat-label' });
  }

  private getConfig(path: string, fallback: any): any {
    const env = this.plugin.env;
    if (!env?.settings) return fallback;
    const keys = path.split('.');
    let val: any = env.settings;
    for (const key of keys) {
      val = val?.[key];
      if (val === undefined) return fallback;
    }
    return val;
  }

  private setConfig(path: string, value: any): void {
    const env = this.plugin.env;
    if (!env?.settings) return;
    const keys = path.split('.');
    let obj: any = env.settings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    env.save_settings?.();
  }
}
