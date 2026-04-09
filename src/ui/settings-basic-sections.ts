import { Setting, type App } from 'obsidian';

import { renderFolderExclusionSettings } from './settings-folder-exclusions-section';
import type { SettingsConfigAccessor, SmartConnectionsPlugin } from './settings-types';

export function renderSourceSettings(
  containerEl: HTMLElement,
  app: App,
  plugin: SmartConnectionsPlugin,
  config: SettingsConfigAccessor,
  redisplay: () => void,
): void {
  new Setting(containerEl)
    .setName('Minimum characters')
    .setDesc('Skip files shorter than this character count')
    .addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(String(config.getConfig('smart_sources.min_chars', 200)));
      text.onChange((value) => {
        config.setConfig('smart_sources.min_chars', parseInt(value) || 200);
      });
    });

  new Setting(containerEl)
    .setName('File exclusions')
    .setDesc('Comma-separated file name patterns to exclude')
    .addText((text) => {
      text.setPlaceholder('Untitled, templates');
      text.setValue(config.getConfig('smart_sources.file_exclusions', ''));
      text.onChange((value) => config.setConfig('smart_sources.file_exclusions', value));
    });

  renderFolderExclusionSettings(containerEl, app, plugin, config, redisplay);

  new Setting(containerEl)
    .setName('Excluded headings')
    .setDesc('Comma-separated heading patterns to skip')
    .addText((text) => {
      text.setPlaceholder('#draft, #ignore');
      text.setValue(config.getConfig('smart_sources.excluded_headings', ''));
      text.onChange((value) => config.setConfig('smart_sources.excluded_headings', value));
    });
}

export function renderBlockSettings(containerEl: HTMLElement, config: SettingsConfigAccessor): void {
  new Setting(containerEl)
    .setName('Enable block-level embedding')
    .setDesc('Embed individual sections for more granular connections')
    .addToggle((toggle) => {
      toggle.setValue(config.getConfig('smart_blocks.embed_blocks', true));
      toggle.onChange((value) => config.setConfig('smart_blocks.embed_blocks', value));
    });

  new Setting(containerEl)
    .setName('Minimum block characters')
    .setDesc('Skip blocks shorter than this character count')
    .addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(String(config.getConfig('smart_blocks.min_chars', 200)));
      text.onChange((value) => config.setConfig('smart_blocks.min_chars', parseInt(value) || 200));
    });

  new Setting(containerEl)
    .setName('Block heading depth')
    .setDesc('Split blocks at heading levels up to this depth (1=h1 only, 6=all headings). H4+ headings merge into their parent block at the default of 3.')
    .addSlider((slider) => {
      slider
        .setLimits(1, 6, 1)
        .setValue(config.getConfig('smart_blocks.block_heading_depth', 3))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('smart_blocks.block_heading_depth', value));
    });

  new Setting(containerEl)
    .setName('Re-embed minimum change')
    .setDesc('Skip re-embedding when content change is smaller than this (chars). Saves API costs on trivial edits.')
    .addSlider((slider) => {
      slider
        .setLimits(0, 500, 10)
        .setValue(config.getConfig('smart_blocks.re_embed_min_change', 200))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('smart_blocks.re_embed_min_change', value));
    });

  new Setting(containerEl)
    .setName('Save frequency')
    .setDesc('Save progress every n batches. Lower = safer on crash, higher = less disk i/o')
    .addSlider((slider) => {
      slider
        .setLimits(1, 50, 1)
        .setValue(config.getConfig('embed_save_interval', 5))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('embed_save_interval', value));
    });

  new Setting(containerEl)
    .setName('Embedding concurrency')
    .setDesc('Number of batches sent to the API simultaneously. Lower if hitting rate limits.')
    .addSlider((slider) => {
      slider
        .setLimits(1, 10, 1)
        .setValue(config.getConfig('embed_concurrency', 5))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('embed_concurrency', value));
    });

  new Setting(containerEl)
    .setName('Discovery chunk size')
    .setDesc('Files processed per chunk during vault discovery. Lower = smoother UI, higher = faster.')
    .addSlider((slider) => {
      slider
        .setLimits(100, 5000, 100)
        .setValue(config.getConfig('discovery_chunk_size', 1000))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('discovery_chunk_size', value));
    });
}

export function renderViewSettings(containerEl: HTMLElement, config: SettingsConfigAccessor): void {
  new Setting(containerEl)
    .setName('Highlight threshold')
    .setDesc('Results above this similarity score are highlighted with your accent color')
    .addSlider((slider) => {
      slider
        .setLimits(0.5, 0.95, 0.05)
        .setValue(config.getConfig('smart_view_filter.highlight_threshold', 0.8))
        .setDynamicTooltip()
        .onChange((value) => config.setConfig('smart_view_filter.highlight_threshold', value));
    });

  new Setting(containerEl)
    .setName('Show full path')
    .setDesc('Display folder path in result titles')
    .addToggle((toggle) => {
      toggle.setValue(config.getConfig('smart_view_filter.show_full_path', false));
      toggle.onChange((value) => config.setConfig('smart_view_filter.show_full_path', value));
    });

  new Setting(containerEl)
    .setName('Render Markdown in preview')
    .setDesc('Render Markdown formatting in hover previews')
    .addToggle((toggle) => {
      toggle.setValue(config.getConfig('smart_view_filter.render_markdown', true));
      toggle.onChange((value) => config.setConfig('smart_view_filter.render_markdown', value));
    });

  new Setting(containerEl)
    .setName('Expanded view')
    .setDesc('Show expanded connection details')
    .addToggle((toggle) => {
      toggle.setValue(config.getConfig('smart_view_filter.expanded_view', false));
      toggle.onChange((value) => config.setConfig('smart_view_filter.expanded_view', value));
    });
}
