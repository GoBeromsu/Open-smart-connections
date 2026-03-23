/**
 * @file settings.ts
 * @description Settings UI for Open Connections plugin
 */

import {
  PluginSettingTab,
  Setting,
  App,
  Plugin,
  Modal,
  ButtonComponent,
  EventRef,
} from 'obsidian';
import type { PluginSettings } from '../types/settings';
import {
  renderModelDropdown,
  renderApiKeyField as renderApiKeyFieldExternal,
  renderHostField as renderHostFieldExternal,
  renderSearchModelPicker,
} from './settings-model-picker';
import { renderEmbedProgress } from './embed-progress';

interface SmartConnectionsPlugin extends Plugin {
  settings?: PluginSettings;
  saveSettings?: () => Promise<void>;
  embed_model?: any;
  source_collection?: any;
  block_collection?: any;
  embed_ready?: boolean;
  ready?: boolean;
  status_state?: 'idle' | 'embedding' | 'error';
  embedding_pipeline?: any;
  initEmbedModel?: () => Promise<void>;
  initPipeline?: () => Promise<void>;
  syncCollectionEmbeddingContext?: () => void;
  queueUnembeddedEntities?: () => number;
  initializeEmbedding?: () => Promise<void>;
  switchEmbeddingModel?: (reason?: string) => Promise<void>;
  reembedStaleEntities?: (reason?: string) => Promise<number>;
  refreshStatus?: () => void;
  getActiveEmbeddingContext?: () => {
    runId: number;
    current: number;
    total: number;
    startedAt?: number;
    currentEntityKey?: string | null;
    currentSourcePath?: string | null;
  } | null;
  notices?: {
    show?: (id: string, params?: Record<string, unknown>, opts?: Record<string, unknown>) => unknown;
    listMuted?: () => string[];
    unmute?: (id: string) => Promise<void>;
    unmuteAll?: () => Promise<void>;
  };
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

    new ButtonComponent(buttonDiv).setButtonText('Cancel').onClick(() => { this.result = false; this.close(); });
    new ButtonComponent(buttonDiv).setButtonText('Confirm').setCta().onClick(() => { this.result = true; this.close(); });
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
  private eventRefs: EventRef[] = [];
  private statusRowEl: HTMLElement | null = null;
  private statsGridEl: HTMLElement | null = null;
  private currentRunEl: HTMLElement | null = null;
  private currentRunSettingEl: HTMLElement | null = null;
  private embedProgress: ReturnType<typeof renderEmbedProgress> | null = null;

  constructor(app: App, plugin: SmartConnectionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private cleanupListeners(): void {
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs = [];
    this.statusRowEl = null;
    this.statsGridEl = null;
    this.currentRunEl = null;
    this.currentRunSettingEl = null;
    this.embedProgress = null;
  }

  hide(): void {
    this.cleanupListeners();
  }

  display(): void {
    this.cleanupListeners();

    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('open-connections-settings');

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

    // Notice Settings
    new Setting(containerEl).setName('Notice Settings').setHeading();
    this.renderNoticeSettings(containerEl);

    // Embedding Status
    new Setting(containerEl).setName('Embedding Status').setHeading();
    this.renderEmbeddingStatus(containerEl);

    // Register live-update listeners for the status section
    this.eventRefs.push(
      this.app.workspace.on('open-connections:embed-progress' as any, () => {
        this.updateEmbeddingStatusOnly();
      }),
    );
    this.eventRefs.push(
      this.app.workspace.on('open-connections:embed-state-changed' as any, () => {
        this.updateEmbeddingStatusOnly();
      }),
    );
  }

  private renderEmbeddingModelSection(containerEl: HTMLElement): void {
    const currentAdapter = this.getConfig('smart_sources.embed_model.adapter', 'transformers');
    const configAccessor = {
      getConfig: (path: string, fallback: any) => this.getConfig(path, fallback),
      setConfig: (path: string, value: any) => this.setConfig(path, value),
    };

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
            const confirmed = await this.confirmReembed(
              'Changing the embedding provider requires re-embedding all notes. This may take a while. Continue?',
            );

            if (!confirmed) {
              dropdown.setValue(oldValue);
              return;
            }
          }
          this.setConfig('smart_sources.embed_model.adapter', value);
          this.ensureModelKeyForAdapter(value);
          this.clearUpstageSearchModelIfStale(value);
          this.display();
          await this.triggerReEmbed();
        });
      });

    // Model dropdown based on current adapter
    renderModelDropdown({
      containerEl,
      adapterName: currentAdapter,
      config: configAccessor,
      confirmReembed: (message) => this.confirmReembed(message),
      triggerReEmbed: () => this.triggerReEmbed(),
      display: () => this.display(),
    });

    // API Key field (for non-local adapters)
    if (['openai', 'gemini', 'upstage', 'open_router'].includes(currentAdapter)) {
      renderApiKeyFieldExternal(containerEl, currentAdapter, configAccessor);
    }

    // Host URL field (for local adapters)
    if (['ollama', 'lm_studio'].includes(currentAdapter)) {
      const defaultHost = currentAdapter === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234';
      renderHostFieldExternal(containerEl, currentAdapter, defaultHost, configAccessor);
    }

    // Search model section
    renderSearchModelPicker({
      containerEl,
      config: configAccessor,
      onChanged: () => this.triggerSearchModelReInit(),
      display: () => this.display(),
    });
  }

  private ensureModelKeyForAdapter(adapterName: string): void {
    const existing = this.getConfig(
      `smart_sources.embed_model.${adapterName}.model_key`,
      '',
    );
    if (typeof existing === 'string' && existing.trim().length > 0) {
      // Still apply Upstage search model auto-population
      if (adapterName === 'upstage') {
        this.autoPopulateUpstageSearchModel();
      }
      return;
    }

    const defaults: Record<string, string> = {
      transformers: 'TaylorAI/bge-micro-v2',
      ollama: 'bge-m3',
      openai: 'text-embedding-3-small',
      gemini: 'text-embedding-004',
      upstage: 'embedding-passage',
    };
    const fallback = defaults[adapterName];
    if (!fallback) return;
    this.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, fallback);

    // Auto-populate search model for Upstage (asymmetric embedding)
    if (adapterName === 'upstage') {
      this.autoPopulateUpstageSearchModel();
    }
  }

  private autoPopulateUpstageSearchModel(): void {
    this.setConfig('smart_sources.search_model', {
      adapter: 'upstage',
      model_key: 'embedding-query',
    });
  }

  /** Clear Upstage-specific search model when switching away from Upstage. */
  private clearUpstageSearchModelIfStale(newAdapter: string): void {
    if (newAdapter === 'upstage') return;
    const searchModel = this.getConfig('smart_sources.search_model', null);
    if (
      searchModel?.adapter === 'upstage' &&
      searchModel?.model_key === 'embedding-query'
    ) {
      this.setConfig('smart_sources.search_model', undefined as any);
    }
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

    new Setting(containerEl)
      .setName('Block heading depth')
      .setDesc('Split blocks at heading levels up to this depth (1=H1 only, 6=all headings). H4+ headings merge into their parent block at the default of 3.')
      .addSlider((slider) => {
        slider
          .setLimits(1, 6, 1)
          .setValue(this.getConfig('smart_blocks.block_heading_depth', 3))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.setConfig('smart_blocks.block_heading_depth', value);
          });
      });

    new Setting(containerEl)
      .setName('Save frequency')
      .setDesc('Save progress every N batches. Lower = safer on crash, higher = less disk I/O')
      .addSlider((slider) => {
        slider
          .setLimits(1, 50, 1)
          .setValue(this.getConfig('embed_save_interval', 5))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.setConfig('embed_save_interval', value);
          });
      });

    new Setting(containerEl)
      .setName('Embedding concurrency')
      .setDesc('Number of batches sent to the API simultaneously. Lower if hitting rate limits.')
      .addSlider((slider) => {
        slider
          .setLimits(1, 10, 1)
          .setValue(this.getConfig('embed_concurrency', 5))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.setConfig('embed_concurrency', value);
          });
      });

    new Setting(containerEl)
      .setName('Discovery chunk size')
      .setDesc('Files processed per chunk during vault discovery. Lower = smoother UI, higher = faster.')
      .addSlider((slider) => {
        slider
          .setLimits(100, 5000, 100)
          .setValue(this.getConfig('discovery_chunk_size', 1000))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.setConfig('discovery_chunk_size', value);
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

  private renderNoticeSettings(containerEl: HTMLElement): void {
    const mutedNotices = this.plugin.notices?.listMuted?.() ?? [];

    new Setting(containerEl)
      .setName('Muted notices')
      .setDesc('Muted notices remain hidden until manually unmuted.')
      .addButton((button) => {
        button
          .setButtonText('Unmute all')
          .setDisabled(mutedNotices.length === 0)
          .onClick(async () => {
            await this.plugin.notices?.unmuteAll?.();
            this.display();
          });
      });

    if (mutedNotices.length === 0) {
      containerEl.createEl('p', {
        text: 'No muted notices.',
        cls: 'setting-item-description osc-muted-notices-empty',
      });
      return;
    }

    const listContainer = containerEl.createDiv({ cls: 'osc-muted-notices-list' });

    for (const noticeId of mutedNotices) {
      new Setting(listContainer)
        .setName(noticeId)
        .setDesc('Muted')
        .addButton((button) => {
          button
            .setButtonText('Unmute')
            .onClick(async () => {
              await this.plugin.notices?.unmute?.(noticeId);
              this.display();
            });
        });
    }
  }

  private renderEmbeddingStatus(containerEl: HTMLElement): void {
    const collection = this.plugin.source_collection;

    const total = collection?.size ?? 0;
    const embedded = collection?.embeddedCount ?? 0;
    const pending = Math.max(0, total - embedded);
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
    const activeCtx = this.plugin.getActiveEmbeddingContext?.() ?? null;
    const status = this.plugin.status_state ?? 'idle';
    const runLabel = this.getRunStateLabel(status);

    const statusRow = containerEl.createDiv({ cls: 'osc-model-status' });
    this.statusRowEl = statusRow;
    this.renderStatusPill(statusRow, 'Core', this.plugin.ready ? 'Ready' : 'Loading', !!this.plugin.ready);
    this.renderStatusPill(
      statusRow,
      'Embedding',
      this.plugin.embed_ready ? 'Ready' : 'Loading',
      !!this.plugin.embed_ready,
    );
    this.renderStatusPill(
      statusRow,
      'Run',
      runLabel,
      status === 'embedding',
      this.getRunStateTone(status),
    );

    const statsGrid = containerEl.createDiv({ cls: 'osc-stats-grid' });
    this.statsGridEl = statsGrid;
    this.renderStatCard(statsGrid, 'Total', total.toLocaleString());
    this.renderStatCard(statsGrid, 'Embedded', embedded.toLocaleString(), 'green');
    this.renderStatCard(statsGrid, 'Pending', pending.toLocaleString(), pending > 0 ? 'amber' : undefined);
    this.renderStatCard(statsGrid, 'Progress', `${pct}%`, pct >= 100 ? 'green' : undefined);

    this.embedProgress = renderEmbedProgress(containerEl, this.plugin);

    {
      const runCurrent = activeCtx?.current ?? embedded;
      const runTotal = activeCtx?.total ?? total;
      const runPercent = runTotal > 0 ? Math.round((runCurrent / runTotal) * 100) : 0;
      const currentItem = activeCtx?.currentSourcePath ?? activeCtx?.currentEntityKey ?? '-';
      let runDesc = '-';
      if (status === 'embedding') {
        runDesc = `Run #${activeCtx?.runId ?? '-'} • ${runCurrent.toLocaleString()}/${runTotal.toLocaleString()} (${runPercent}%) • ${currentItem}`;
      } else if (status === 'error') {
        runDesc = 'Embedding run encountered an error. Check notices for details.';
      }
      const runSetting = new Setting(containerEl)
        .setName('Current run')
        .setDesc(runDesc);
      this.currentRunEl = runSetting.descEl;
      this.currentRunSettingEl = runSetting.settingEl;
      if (status === 'idle') {
        runSetting.settingEl.style.display = 'none';
      }
    }

    const actionSetting = new Setting(containerEl)
      .setName('Actions')
      .setDesc('Control the embedding pipeline.');

    actionSetting.addButton((button) => {
      button
        .setButtonText('Re-embed stale')
        .onClick(async () => {
          const count = await this.plugin.reembedStaleEntities?.('Settings re-embed');
          if (count === 0) {
            this.plugin.notices?.show?.('no_stale_entities');
          }
          this.display();
        });
    });
  }

  private updateEmbeddingStatusOnly(): void {
    if (this.statusRowEl) this.updateStatusPills(this.statusRowEl);
    if (this.statsGridEl) {
      const collection = this.plugin.source_collection;
      const total = collection?.size ?? 0;
      const embedded = collection?.embeddedCount ?? 0;
      const pending = Math.max(0, total - embedded);
      const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
      this.statsGridEl.empty();
      this.renderStatCard(this.statsGridEl, 'Total', total.toLocaleString());
      this.renderStatCard(this.statsGridEl, 'Embedded', embedded.toLocaleString(), 'green');
      this.renderStatCard(this.statsGridEl, 'Pending', pending.toLocaleString(), pending > 0 ? 'amber' : undefined);
      this.renderStatCard(this.statsGridEl, 'Progress', `${pct}%`, pct >= 100 ? 'green' : undefined);
    }

    // Live-update progress bars and current run section
    this.embedProgress?.update();
    const ctx = (this.plugin as any).current_embed_context;
    const status = this.plugin.status_state ?? 'idle';
    if (this.currentRunEl) {
      if (status === 'embedding' && ctx) {
        if (this.currentRunSettingEl) this.currentRunSettingEl.style.display = '';
        const runCurrent: number = ctx.current ?? 0;
        const runTotal: number = ctx.total ?? 0;
        const runPercent = runTotal > 0 ? Math.round((runCurrent / runTotal) * 100) : 0;
        const currentItem: string = ctx.currentSourcePath ?? ctx.currentEntityKey ?? '-';
        this.currentRunEl.setText(
          `Run #${ctx.runId ?? '-'} • ${runCurrent.toLocaleString()}/${runTotal.toLocaleString()} (${runPercent}%) • ${currentItem}`,
        );
      } else {
        if (this.currentRunSettingEl) this.currentRunSettingEl.style.display = 'none';
      }
    }
  }

  private updateStatusPills(statusRow: HTMLElement): void {
    const status = this.plugin.status_state ?? 'idle';
    const runLabel = this.getRunStateLabel(status);
    statusRow.empty();
    this.renderStatusPill(statusRow, 'Core', this.plugin.ready ? 'Ready' : 'Loading', !!this.plugin.ready);
    this.renderStatusPill(
      statusRow,
      'Embedding',
      this.plugin.embed_ready ? 'Ready' : 'Loading',
      !!this.plugin.embed_ready,
    );
    this.renderStatusPill(
      statusRow,
      'Run',
      runLabel,
      status === 'embedding',
      this.getRunStateTone(status),
    );
  }

  private getRunStateLabel(
    status: NonNullable<SmartConnectionsPlugin['status_state']>,
  ): string {
    switch (status) {
      case 'embedding':
        return 'Running';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }

  private getRunStateTone(
    status: NonNullable<SmartConnectionsPlugin['status_state']>,
  ): 'ready' | 'loading' | 'error' {
    switch (status) {
      case 'error':
        return 'error';
      case 'embedding':
        return 'ready';
      default:
        return 'loading';
    }
  }

  private renderStatusPill(
    containerEl: HTMLElement,
    label: string,
    value: string,
    active: boolean,
    tone: 'ready' | 'loading' | 'error' = active ? 'ready' : 'loading',
  ): void {
    const pill = containerEl.createDiv({ cls: 'osc-status-pill' });
    const dot = pill.createSpan({ cls: 'osc-status-dot' });
    const dotClassMap: Record<string, string> = {
      error: 'osc-status-dot--error',
      ready: 'osc-status-dot--ready',
      loading: 'osc-status-dot--loading',
    };
    dot.addClass(dotClassMap[tone] ?? 'osc-status-dot--loading');
    pill.createSpan({
      cls: 'osc-status-text',
      text: `${label}: ${value}`,
    });
  }

  private renderStatCard(
    containerEl: HTMLElement,
    label: string,
    value: string,
    tone?: 'green' | 'amber',
  ): void {
    const card = containerEl.createDiv({ cls: 'osc-stat-card' });
    if (tone === 'green') card.addClass('osc-stat--green');
    else if (tone === 'amber') card.addClass('osc-stat--amber');
    card.createDiv({ cls: 'osc-stat-value', text: value });
    card.createDiv({ cls: 'osc-stat-label', text: label });
  }

  private async confirmReembed(message: string): Promise<boolean> {
    return await new ConfirmModal(this.app, message).open();
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
    this.app.workspace.trigger('open-connections:settings-changed' as any, {
      key: path,
      oldValue,
      newValue: value,
    });
  }

  private async triggerReEmbed(): Promise<void> {
    const plugin = this.plugin;
    plugin.notices?.show?.('reinitializing_embedding_model');

    try {
      await plugin.switchEmbeddingModel?.('Settings model switch');

      plugin.notices?.show?.('embedding_model_switched');
      this.display();
    } catch (e) {
      plugin.notices?.show?.('failed_reinitialize_model');
      console.error('Re-embed failed:', e);
    }
  }

  private triggerSearchModelReInit(): void {
    // Re-init search model without re-embedding (search model change doesn't affect stored vectors)
    this.plugin.switchEmbeddingModel?.('Search model changed').catch((e) => {
      console.error('Search model re-init failed:', e);
    });
  }
}
