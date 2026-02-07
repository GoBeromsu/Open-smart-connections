/**
 * @file settings.ts
 * @description Settings UI for Smart Connections plugin
 */

import { PluginSettingTab, Setting, Notice, App, Plugin, Modal } from 'obsidian';
import type { PluginSettings } from '../core/types/settings';

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

interface SmartConnectionsPlugin extends Plugin {
  settings?: PluginSettings;
  saveSettings?: () => Promise<void>;
  embed_model?: any;
  source_collection?: any;
  block_collection?: any;
  embed_ready?: boolean;
  ready?: boolean;
  status_state?: 'idle' | 'loading_model' | 'embedding' | 'stopping' | 'paused' | 'error';
  embedding_pipeline?: any;
  initEmbedModel?: () => Promise<void>;
  initPipeline?: () => Promise<void>;
  syncCollectionEmbeddingContext?: () => void;
  queueUnembeddedEntities?: () => number;
  processInitialEmbedQueue?: () => Promise<void>;
  initializeEmbedding?: () => Promise<void>;
  switchEmbeddingModel?: (reason?: string) => Promise<void>;
  reembedStaleEntities?: (reason?: string) => Promise<number>;
  resumeEmbedding?: (reason?: string) => Promise<void>;
  refreshStatus?: () => void;
  requestEmbeddingStop?: (reason?: string) => boolean;
  waitForEmbeddingToStop?: (timeoutMs?: number) => Promise<boolean>;
}

class ConfirmModal extends Modal {
  result: boolean = false;
  private resolvePromise: (value: boolean) => void;
  private message: string;

  constructor(app: App, message: string) {
    super(app);
    this.message = message;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('p', { text: this.message });

    const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });

    buttonDiv.createEl('button', { text: 'Cancel', cls: 'mod-cancel' })
      .addEventListener('click', () => { this.result = false; this.close(); });

    buttonDiv.createEl('button', { text: 'Confirm', cls: 'mod-cta' })
      .addEventListener('click', () => { this.result = true; this.close(); });
  }

  onClose() {
    this.contentEl.empty();
    this.resolvePromise(this.result);
  }

  open(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      super.open();
    });
  }
}

export class SmartConnectionsSettingsTab extends PluginSettingTab {
  plugin: SmartConnectionsPlugin;

  constructor(app: App, plugin: SmartConnectionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }


  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('smart-connections-settings');

    // Embedding Model Section
    new Setting(containerEl).setName('Embedding Model').setHeading();
    this.renderEmbeddingModelSection(containerEl);

    // Source Settings
    new Setting(containerEl).setName('Source Settings').setHeading();
    this.renderSourceSettings(containerEl);

    // Block Settings
    new Setting(containerEl).setName('Block Settings').setHeading();
    this.renderBlockSettings(containerEl);

    // View Settings
    new Setting(containerEl).setName('View Settings').setHeading();
    this.renderViewSettings(containerEl);

    // Embedding Status
    new Setting(containerEl).setName('Embedding Status').setHeading();
    this.renderEmbeddingStatus(containerEl);

    // Beta Features
    new Setting(containerEl).setName('Beta Features').setHeading();
    this.renderBetaFeatures(containerEl);
  }

  private renderEmbeddingModelSection(containerEl: HTMLElement): void {
    const currentAdapter = this.getConfig('smart_sources.embed_model.adapter', 'transformers');

    // Provider dropdown
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Embedding model provider')
      .addDropdown((dropdown) => {
        const providers = [
          { value: 'transformers', name: 'Transformers (Local)' },
          { value: 'openai', name: 'OpenAI' },
          { value: 'ollama', name: 'Ollama (Local)' },
          { value: 'gemini', name: 'Google Gemini' },
          { value: 'lm_studio', name: 'LM Studio (Local)' },
          { value: 'upstage', name: 'Upstage' },
          { value: 'open_router', name: 'Open Router' },
        ];
        providers.forEach((p) => {
          dropdown.addOption(p.value, p.name);
        });
        dropdown.setValue(currentAdapter);
        dropdown.onChange(async (value) => {
          const oldValue = currentAdapter;
          if (value !== oldValue) {
            const confirmed = await new ConfirmModal(
              this.app,
              'Changing the embedding provider requires re-embedding all notes. This may take a while. Continue?'
            ).open();

            if (!confirmed) {
              dropdown.setValue(oldValue);
              return;
            }
          }
          this.setConfig('smart_sources.embed_model.adapter', value);
          this.display();
          await this.triggerReEmbed();
        });
      });

    // Model dropdown based on current adapter
    this.renderModelDropdownSimple(containerEl, currentAdapter);

    // API Key field (for non-local adapters)
    if (['openai', 'gemini', 'upstage', 'open_router'].includes(currentAdapter)) {
      this.renderApiKeyField(containerEl, currentAdapter);
    }

    // Host URL field (for local adapters)
    if (['ollama', 'lm_studio'].includes(currentAdapter)) {
      this.renderHostField(containerEl, currentAdapter, currentAdapter === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234');
    }
  }

  private renderModelDropdownSimple(containerEl: HTMLElement, adapterName: string): void {
    const currentModelKey = this.getConfig(
      `smart_sources.embed_model.${adapterName}.model_key`,
      '',
    );

    // Known models per adapter
    const KNOWN_MODELS: Record<string, Array<{ value: string; name: string }>> = {
      transformers: [
        { value: 'TaylorAI/bge-micro-v2', name: 'BGE-micro-v2 (384d, recommended)' },
        { value: 'TaylorAI/gte-tiny', name: 'GTE-tiny (384d)' },
        { value: 'Xenova/bge-small-en-v1.5', name: 'BGE-small (384d)' },
        { value: 'Snowflake/snowflake-arctic-embed-xs', name: 'Arctic Embed XS (384d)' },
        { value: 'Snowflake/snowflake-arctic-embed-s', name: 'Arctic Embed S (384d)' },
        { value: 'Snowflake/snowflake-arctic-embed-m', name: 'Arctic Embed M (768d)' },
        { value: 'nomic-ai/nomic-embed-text-v1.5', name: 'Nomic v1.5 (768d)' },
        { value: 'Xenova/jina-embeddings-v2-small-en', name: 'Jina v2 Small EN (512d)' },
        { value: 'Xenova/jina-embeddings-v2-base-zh', name: 'Jina v2 Base ZH (768d)' },
        { value: 'andersonbcdefg/bge-small-4096', name: 'BGE-small-4K (384d)' },
      ],
      openai: [
        { value: 'text-embedding-3-small', name: 'text-embedding-3-small (1536d)' },
        { value: 'text-embedding-3-large', name: 'text-embedding-3-large (3072d)' },
        { value: 'text-embedding-ada-002', name: 'text-embedding-ada-002 (1536d)' },
      ],
      gemini: [
        { value: 'text-embedding-004', name: 'text-embedding-004 (768d)' },
      ],
      upstage: [
        { value: 'solar-embedding-1-large-passage', name: 'Solar Embedding Large Passage' },
        { value: 'solar-embedding-1-large-query', name: 'Solar Embedding Large Query' },
      ],
    };

    const knownModels = KNOWN_MODELS[adapterName];

    if (knownModels) {
      // Hybrid: dropdown for known models + "Custom" option
      const isCustom = !knownModels.some(m => m.value === currentModelKey) && currentModelKey !== '';

      new Setting(containerEl)
        .setName('Model')
        .setDesc('Embedding model')
        .addDropdown((dropdown) => {
          knownModels.forEach((m) => {
            dropdown.addOption(m.value, m.name);
          });
          dropdown.addOption('__custom__', 'Custom...');
          dropdown.setValue(isCustom ? '__custom__' : currentModelKey);
          dropdown.onChange(async (value) => {
            if (value === '__custom__') {
              this.display();
              return;
            }
            const oldValue = currentModelKey;
            if (value !== oldValue) {
              const confirmed = await new ConfirmModal(
                this.app,
                'Changing the embedding model requires re-embedding all notes. This may take a while. Continue?'
              ).open();

              if (!confirmed) {
                dropdown.setValue(isCustom ? '__custom__' : oldValue);
                return;
              }
            }
            this.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, value);
            await this.triggerReEmbed();
          });
        });

      // Show text input for custom model
      if (isCustom || this.getConfig(`smart_sources.embed_model.${adapterName}.model_key`, '') === '__custom__') {
        let pendingCustomModel = isCustom ? currentModelKey : '';
        new Setting(containerEl)
          .setName('Custom model key')
          .setDesc('Enter a custom model identifier')
          .addText((text) => {
            text.setPlaceholder('e.g., org/model-name');
            text.setValue(pendingCustomModel);
            text.onChange((value) => {
              pendingCustomModel = value.trim();
            });
          })
          .addButton((button) => {
            button.setButtonText('Apply');
            button.setCta();
            button.onClick(async () => {
              const nextValue = pendingCustomModel.trim();
              if (!nextValue || nextValue === currentModelKey) return;
              const confirmed = await new ConfirmModal(
                this.app,
                'Applying a custom embedding model requires re-embedding notes. Continue?',
              ).open();
              if (!confirmed) return;
              this.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, nextValue);
              await this.triggerReEmbed();
            });
          });
      }
    } else {
      // Text input only (for ollama, lm_studio, open_router)
      let pendingModelKey = currentModelKey;
      new Setting(containerEl)
        .setName('Model')
        .setDesc('Embedding model key')
        .addText((text) => {
          text.setPlaceholder(adapterName === 'ollama' ? 'nomic-embed-text' : 'Model key');
          text.setValue(currentModelKey);
          text.onChange((value) => {
            pendingModelKey = value.trim();
          });
        })
        .addButton((button) => {
          button.setButtonText('Apply');
          button.setCta();
          button.onClick(async () => {
            if (!pendingModelKey || pendingModelKey === currentModelKey) return;
            const confirmed = await new ConfirmModal(
              this.app,
              'Changing the embedding model requires re-embedding all notes. Continue?',
            ).open();
            if (!confirmed) return;
            this.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, pendingModelKey);
            await this.triggerReEmbed();
          });
        });
    }
  }

  private renderApiKeyField(containerEl: HTMLElement, adapterName: string): void {
    const currentApiKey = this.getConfig(
      `smart_sources.embed_model.${adapterName}.api_key`,
      '',
    );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('API key for authentication')
      .addText((text) => {
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
      .addText((text) => {
        text.setPlaceholder(defaultHost);
        text.setValue(currentHost);
        text.onChange(async (value) => {
          this.setConfig(`smart_sources.embed_model.${adapterName}.host`, value);
        });
      });
  }

  private renderSourceSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Minimum characters')
      .setDesc('Skip files shorter than this character count')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.getConfig('smart_sources.min_chars', 200)));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.min_chars', parseInt(value) || 200);
        });
      });

    new Setting(containerEl)
      .setName('File exclusions')
      .setDesc('Comma-separated file name patterns to exclude')
      .addText((text) => {
        text.setPlaceholder('Untitled, Templates');
        text.setValue(this.getConfig('smart_sources.file_exclusions', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.file_exclusions', value);
        });
      });

    new Setting(containerEl)
      .setName('Folder exclusions')
      .setDesc('Comma-separated folder paths to exclude')
      .addText((text) => {
        text.setPlaceholder('archive/, templates/');
        text.setValue(this.getConfig('smart_sources.folder_exclusions', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.folder_exclusions', value);
        });
      });

    new Setting(containerEl)
      .setName('Excluded headings')
      .setDesc('Comma-separated heading patterns to skip')
      .addText((text) => {
        text.setPlaceholder('#draft, #ignore');
        text.setValue(this.getConfig('smart_sources.excluded_headings', ''));
        text.onChange(async (value) => {
          this.setConfig('smart_sources.excluded_headings', value);
        });
      });
  }

  private renderBlockSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Enable block-level embedding')
      .setDesc('Embed individual sections for more granular connections')
      .addToggle((toggle) => {
        toggle.setValue(this.getConfig('smart_blocks.embed_blocks', true));
        toggle.onChange(async (value) => {
          this.setConfig('smart_blocks.embed_blocks', value);
        });
      });

    new Setting(containerEl)
      .setName('Minimum block characters')
      .setDesc('Skip blocks shorter than this character count')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.getConfig('smart_blocks.min_chars', 200)));
        text.onChange(async (value) => {
          this.setConfig('smart_blocks.min_chars', parseInt(value) || 200);
        });
      });
  }

  private renderViewSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Show full path')
      .setDesc('Display folder path in result titles')
      .addToggle((toggle) => {
        toggle.setValue(this.getConfig('smart_view_filter.show_full_path', false));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.show_full_path', value);
        });
      });

    new Setting(containerEl)
      .setName('Render markdown in preview')
      .setDesc('Render markdown formatting in hover previews')
      .addToggle((toggle) => {
        toggle.setValue(this.getConfig('smart_view_filter.render_markdown', true));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.render_markdown', value);
        });
      });

    new Setting(containerEl)
      .setName('Expanded view')
      .setDesc('Show expanded connection details')
      .addToggle((toggle) => {
        toggle.setValue(this.getConfig('smart_view_filter.expanded_view', false));
        toggle.onChange(async (value) => {
          this.setConfig('smart_view_filter.expanded_view', value);
        });
      });
  }


  private renderEmbeddingStatus(containerEl: HTMLElement): void {
    const collection = this.plugin.source_collection;

    const total = collection?.size ?? 0;
    const embedded = collection?.all?.filter((s: any) => s.vec)?.length ?? 0;
    const pending = total - embedded;
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;

    // Stats
    const statsDiv = containerEl.createDiv({ cls: 'setting-item-description' });
    statsDiv.createEl('div', { text: `Total sources: ${total}` });
    statsDiv.createEl('div', { text: `Embedded: ${embedded}` });
    statsDiv.createEl('div', { text: `Pending: ${pending}` });
    statsDiv.createEl('div', { text: `Progress: ${pct}%` });

    // Ready status
    const statusDiv = containerEl.createDiv({ cls: 'setting-item-description' });
    statusDiv.createEl('div', {
      text: this.plugin.ready ? 'Core: Ready' : 'Core: Loading...'
    });
    statusDiv.createEl('div', {
      text: this.plugin.embed_ready ? 'Embedding: Ready' : 'Embedding: Loading...'
    });
  }



  private getConfig(path: string, fallback: any): any {
    const settings = this.plugin.settings;
    if (!settings) return fallback;
    const keys = path.split('.');
    let val: any = settings;
    for (const key of keys) {
      val = val?.[key];
      if (val === undefined) return fallback;
    }
    return val;
  }

  private setConfig(path: string, value: any): void {
    const settings = this.plugin.settings;
    if (!settings) return;
    const keys = path.split('.');
    let obj: any = settings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = obj[lastKey];
    obj[lastKey] = value;

    // Save settings
    this.plugin.saveSettings?.();

    // Emit settings changed event with the changed key
    this.app.workspace.trigger('smart-connections:settings-changed' as any, {
      key: path,
      oldValue,
      newValue: value,
    });
  }

  private async triggerReEmbed(): Promise<void> {
    const plugin = this.plugin;
    new Notice('Smart Connections: Re-initializing embedding model...');

    try {
      plugin.status_state = 'loading_model';
      plugin.embed_ready = false;
      plugin.refreshStatus?.();

      if (plugin.switchEmbeddingModel) {
        await plugin.switchEmbeddingModel('Settings model switch');
      } else {
        if (plugin.embedding_pipeline?.is_active?.()) {
          plugin.requestEmbeddingStop?.('Embedding model switch requested');
          const stopped = (await plugin.waitForEmbeddingToStop?.(60000)) ?? true;
          if (!stopped) {
            plugin.embed_ready = false;
            plugin.status_state = 'error';
            plugin.refreshStatus?.();
            new Notice('Smart Connections: Failed to stop previous embedding run. Try again.');
            return;
          }
        }

        await plugin.initEmbedModel?.();
        plugin.syncCollectionEmbeddingContext?.();
        const queued = plugin.queueUnembeddedEntities?.() ?? 0;
        await plugin.initPipeline?.();
        plugin.status_state = 'idle';
        plugin.embed_ready = true;
        plugin.refreshStatus?.();
        this.app.workspace.trigger('smart-connections:embed-ready' as any);
        if (queued > 0) {
          void plugin.processInitialEmbedQueue?.().catch((error) => {
            console.error('Re-embedding failed:', error);
            new Notice('Smart Connections: Re-embedding failed. See console for details.');
          });
        }
      }

      new Notice('Smart Connections: Embedding model switched.');
      this.display();
    } catch (e) {
      plugin.embed_ready = false;
      plugin.status_state = 'error';
      plugin.refreshStatus?.();
      new Notice('Smart Connections: Failed to re-initialize model. Check console.');
      console.error('Re-embed failed:', e);
    }
  }

  private renderBetaFeatures(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Enable Chat')
      .setDesc('Enable the Smart Chat feature (experimental). Requires plugin reload.')
      .addToggle((toggle) => {
        toggle.setValue(this.getConfig('enable_chat', false));
        toggle.onChange(async (value) => {
          this.setConfig('enable_chat', value);
          new Notice('Smart Connections: Restart plugin for chat changes to take effect.');
        });
      });
  }
}
