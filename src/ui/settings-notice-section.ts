import { Setting } from 'obsidian';

import type { SmartConnectionsPlugin } from './settings-types';

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
