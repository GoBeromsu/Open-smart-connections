import { Setting, type App } from 'obsidian';

import { buildFolderExclusionConfirmMessage, queueExcludedFolderReconcile } from './folder-exclusion-actions';
import { FolderExclusionPickerModal } from './folder-exclusion-modal';
import {
  addExcludedFolderPath,
  listVaultFolderPaths,
  parseExcludedFolderPaths,
  removeExcludedFolderPath,
} from './folder-exclusion-state';
import { confirmWithModal } from './settings-confirm-modal';
import type { SettingsConfigAccessor, SmartConnectionsPlugin } from './settings-types';

async function handleAddExcludedFolder(
  app: App,
  plugin: SmartConnectionsPlugin,
  config: SettingsConfigAccessor,
  redisplay: () => void,
): Promise<void> {
  const existing = config.getConfig('smart_sources.folder_exclusions', '');
  const excluded = parseExcludedFolderPaths(existing);
  const folderPaths = listVaultFolderPaths(app).filter((path) => !excluded.includes(path));
  const selected = await new FolderExclusionPickerModal(app, folderPaths).openModal();
  if (!selected) return;

  const activeRun = plugin.getEmbedRuntimeState?.().backfill.kind === 'running';
  const confirmed = await confirmWithModal(
    app,
    buildFolderExclusionConfirmMessage(selected, activeRun),
  );
  if (!confirmed) return;

  config.setConfig('smart_sources.folder_exclusions', addExcludedFolderPath(existing, selected));
  await queueExcludedFolderReconcile(plugin, `Excluded folder selected: ${selected}`);
  redisplay();
}

async function handleRemoveExcludedFolder(
  plugin: SmartConnectionsPlugin,
  config: SettingsConfigAccessor,
  redisplay: () => void,
  folderPath: string,
): Promise<void> {
  const existing = config.getConfig('smart_sources.folder_exclusions', '');
  config.setConfig('smart_sources.folder_exclusions', removeExcludedFolderPath(existing, folderPath));
  await queueExcludedFolderReconcile(plugin, `Excluded folder removed: ${folderPath}`);
  redisplay();
}

export function renderFolderExclusionSettings(
  containerEl: HTMLElement,
  app: App,
  plugin: SmartConnectionsPlugin,
  config: SettingsConfigAccessor,
  redisplay: () => void,
): void {
  const excludedFolders = parseExcludedFolderPaths(
    config.getConfig('smart_sources.folder_exclusions', ''),
  );

  new Setting(containerEl)
    .setName('Excluded folders')
    .setDesc('Choose vault folders to exclude. Confirming will remove existing embeddings for that folder.')
    .addButton((button) => {
      button
        .setButtonText('Add folder')
        .setCta()
        .onClick(() => {
          void handleAddExcludedFolder(app, plugin, config, redisplay);
        });
    });

  if (excludedFolders.length === 0) {
    containerEl.createEl('p', {
      text: 'No excluded folders configured.',
      cls: 'setting-item-description',
    });
    return;
  }

  const list = containerEl.createDiv({ cls: 'osc-excluded-folders-list' });
  for (const folderPath of excludedFolders) {
    new Setting(list)
      .setName(folderPath)
      .setDesc('Excluded')
      .addButton((button) => {
        button
          .setButtonText('×')
          .setClass('mod-warning')
          .onClick(() => {
            void handleRemoveExcludedFolder(plugin, config, redisplay, folderPath);
          });
      });
  }
}
