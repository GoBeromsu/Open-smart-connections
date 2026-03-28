import { Menu, setIcon } from 'obsidian';

import type { ConnectionResult } from '../types/entities';
import type { ConnectionsView } from './ConnectionsView';
import { enqueueBlocksForEmbedding } from './connections-view-auto-embed';
import { saveConnectionsSession } from './connections-view-session';
import { getConnectionsResultSourcePath } from './connections-view-result-list';

export function renderPauseButton(view: ConnectionsView, actions: HTMLElement, targetPath: string): void {
  const pauseBtn = actions.createEl('button', {
    cls: 'plugin-icon-btn',
    attr: { 'aria-label': view.session.paused ? 'Resume' : 'Pause' },
  });
  setIcon(pauseBtn, view.session.paused ? 'play' : 'pause');
  if (view.session.paused) pauseBtn.addClass('plugin-icon-btn--active');

  view.registerDomEvent(pauseBtn, 'click', () => {
    view.session.paused = !view.session.paused;
    if (view.session.paused) {
      view.session.pausedPath = targetPath;
    } else {
      delete view.session.pausedPath;
      const active = view.app.workspace.getActiveFile();
      if (active) void view.renderView(active.path);
    }
    void saveConnectionsSession(view);
    setIcon(pauseBtn, view.session.paused ? 'play' : 'pause');
    pauseBtn.toggleClass('plugin-icon-btn--active', view.session.paused);
    pauseBtn.setAttribute('aria-label', view.session.paused ? 'Resume' : 'Pause');
  });
}

export function renderFilterButton(
  view: ConnectionsView,
  actions: HTMLElement,
  targetPath: string,
  results: ConnectionResult[],
): void {
  const filterBtn = actions.createEl('button', {
    cls: `plugin-icon-btn${view.folderFilter ? ' plugin-icon-btn--active' : ''}`,
    attr: { 'aria-label': view.folderFilter ? `Filter: ${view.folderFilter}` : 'Filter by folder' },
  });
  setIcon(filterBtn, 'filter');

  view.registerDomEvent(filterBtn, 'click', () => {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle('All folders').setIcon('folder').onClick(() => {
        view.folderFilter = '';
        void view.renderView(targetPath);
      }),
    );

    const folders = new Set<string>();
    for (const result of results) {
      const sourcePath = getConnectionsResultSourcePath(result);
      const firstFolder = sourcePath.split('/')[0];
      if (sourcePath.includes('/') && firstFolder) folders.add(firstFolder);
    }
    for (const folder of Array.from(folders).sort()) {
      menu.addItem((item) =>
        item
          .setTitle(folder)
          .setIcon(view.folderFilter === folder ? 'check' : 'folder')
          .onClick(() => {
            view.folderFilter = view.folderFilter === folder ? '' : folder;
            void view.renderView(targetPath);
          }),
      );
    }

    menu.showAtMouseEvent(new MouseEvent('click', {
      clientX: filterBtn.getBoundingClientRect().left,
      clientY: filterBtn.getBoundingClientRect().bottom,
    }));
  });
}

export function renderRefreshButton(view: ConnectionsView, actions: HTMLElement, targetPath: string): void {
  const refreshBtn = actions.createEl('button', {
    cls: 'plugin-icon-btn',
    attr: { 'aria-label': 'Refresh' },
  });
  setIcon(refreshBtn, 'refresh-cw');

  view.registerDomEvent(refreshBtn, 'click', async () => {
    try {
      const fileBlocks = view.plugin.block_collection?.for_source(targetPath) ?? [];
      if (fileBlocks.length > 0) {
        enqueueBlocksForEmbedding(fileBlocks);
        await view.plugin.runEmbeddingJob('Connections view refresh');
      }
    } catch {
      return;
    }
    void view.renderView(targetPath);
  });
}
