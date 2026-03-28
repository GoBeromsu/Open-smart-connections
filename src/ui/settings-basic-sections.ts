import { Setting } from 'obsidian';

import type { SettingsConfigAccessor, SmartConnectionsPlugin } from './settings-types';

export function renderSourceSettings(containerEl: HTMLElement, config: SettingsConfigAccessor): void {
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

  new Setting(containerEl)
    .setName('Folder exclusions')
    .setDesc('Comma-separated folder paths to exclude')
    .addText((text) => {
      text.setPlaceholder('Archive/, templates/');
      text.setValue(config.getConfig('smart_sources.folder_exclusions', ''));
      text.onChange((value) => config.setConfig('smart_sources.folder_exclusions', value));
    });

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

export function renderNoticeSettings(
  containerEl: HTMLElement,
  plugin: SmartConnectionsPlugin,
  display: () => void,
): void {
  const mutedNotices = plugin.notices?.listMuted?.() ?? [];

  new Setting(containerEl)
    .setName('Muted notices')
    .setDesc('Muted notices remain hidden until manually unmuted.')
    .addButton((button) => {
      button
        .setButtonText('Unmute all')
        .setDisabled(mutedNotices.length === 0)
        .onClick(async () => {
          await plugin.notices?.unmuteAll?.();
          display();
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
        button.setButtonText('Unmute').onClick(async () => {
          await plugin.notices?.unmute?.(noticeId);
          display();
        });
      });
  }
}
