import { PluginSettingTab, Setting } from 'obsidian';

export class OscSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('osc-settings');

    // ── Embedding Model ──
    new Setting(containerEl).setName('Embedding Model').setHeading();

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Local embedding model for generating note vectors')
      .addDropdown(dropdown => {
        dropdown.addOption('TaylorAI/bge-micro-v2', 'bge-micro-v2 (Local)');
        const currentModel = this.getConfig('smart_sources.embed_model.transformers.model_key', 'TaylorAI/bge-micro-v2');
        dropdown.setValue(currentModel);
        dropdown.onChange(async (value) => {
          this.setConfig('smart_sources.embed_model.transformers.model_key', value);
        });
      });

    this.renderModelStatus(containerEl);

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

  renderModelStatus(containerEl) {
    const env = this.plugin.env;
    const statusEl = containerEl.createDiv({ cls: 'osc-model-status' });
    if (env?.smart_embed_model?.loaded) {
      statusEl.createSpan({ cls: 'osc-status-dot osc-status-dot--ready' });
      statusEl.createSpan({ text: 'Ready', cls: 'osc-status-text' });
    } else {
      statusEl.createSpan({ cls: 'osc-status-dot osc-status-dot--loading' });
      statusEl.createSpan({ text: 'Loading model...', cls: 'osc-status-text' });
    }
  }

  renderEmbeddingStatus(containerEl) {
    const env = this.plugin.env;
    const sources = env?.smart_sources;

    const total = sources?.keys?.length ?? 0;
    const embedded = sources?.embedded_items?.length
      ?? sources?.keys?.filter(k => sources.get(k)?.vec)?.length
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

  createStatCard(parent, label, value, cls = '') {
    const card = parent.createDiv({ cls: `osc-stat-card ${cls}`.trim() });
    card.createDiv({ text: value, cls: 'osc-stat-value' });
    card.createDiv({ text: label, cls: 'osc-stat-label' });
  }

  getConfig(path, fallback) {
    const env = this.plugin.env;
    if (!env?.settings) return fallback;
    const keys = path.split('.');
    let val = env.settings;
    for (const key of keys) {
      val = val?.[key];
      if (val === undefined) return fallback;
    }
    return val;
  }

  setConfig(path, value) {
    const env = this.plugin.env;
    if (!env?.settings) return;
    const keys = path.split('.');
    let obj = env.settings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    env.save_settings?.();
  }
}
