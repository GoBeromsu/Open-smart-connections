import { ButtonComponent, TFile, setIcon } from 'obsidian';

import type { ConnectionResult } from '../types/entities';
import type { ConnectionsView } from './ConnectionsView';
import { clearEmbedProgress, updateConnectionsProgressBanner } from './connections-view-progress';
import { renderFilterButton, renderPauseButton, renderRefreshButton } from './connections-view-result-actions';
import {
  getConnectionsResultSourcePath,
  renderConnectionsResultList,
} from './connections-view-result-list';

export async function openConnectionsBlockResult(
  view: ConnectionsView,
  sourcePath: string,
  heading: string,
  event?: MouseEvent,
): Promise<void> {
  const file = view.app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return;
  const leaf = (event?.ctrlKey || event?.metaKey)
    ? view.app.workspace.getLeaf('tab')
    : view.app.workspace.getMostRecentLeaf() ?? view.app.workspace.getLeaf(false);
  await leaf.openFile(file, heading ? { eState: { subpath: `#${heading}` } } : undefined);
}

export function renderConnectionsResults(
  view: ConnectionsView,
  targetPath: string,
  results: ConnectionResult[],
): void {
  const resultKeys = results.map((result) => result.item.key + ':' + Math.round((result.score ?? 0) * 100));
  const renderFingerprint = JSON.stringify({
    targetPath,
    resultKeys,
    folderFilter: view.folderFilter,
    pinnedKeys: [...view.session.pinnedKeys].sort(),
    hiddenKeys: [...view.session.hiddenKeys].sort(),
  });
  if (renderFingerprint === view.lastRenderFingerprint) {
    return;
  }
  view.lastRenderFingerprint = renderFingerprint;
  view._lastResultKeys = resultKeys;

  clearEmbedProgress(view);
  view.container.empty();

  const fileName = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';
  const header = view.container.createDiv({ cls: 'osc-header' });
  header.createSpan({ text: fileName, cls: 'osc-header-title' });
  const actions = header.createDiv({ cls: 'osc-header-actions' });

  renderPauseButton(view, actions, targetPath);
  renderFilterButton(view, actions, targetPath, results);
  renderRefreshButton(view, actions, targetPath);

  const filtered = results.filter((result) => {
    const sourcePath = getConnectionsResultSourcePath(result);
    if (view.session.hiddenKeys.includes(sourcePath)) return false;
    if (view.folderFilter && !sourcePath.startsWith(view.folderFilter + '/')) return false;
    return true;
  });

  if (filtered.length === 0) {
    showConnectionsEmpty(view, 'No similar notes found', false);
    return;
  }

  const pinnedSet = new Set(view.session.pinnedKeys);
  filtered.sort((left, right) => {
    const leftPinned = pinnedSet.has(getConnectionsResultSourcePath(left)) ? 1 : 0;
    const rightPinned = pinnedSet.has(getConnectionsResultSourcePath(right)) ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return (right.score ?? 0) - (left.score ?? 0);
  });

  const list = view.container.createDiv({ cls: 'osc-results', attr: { role: 'list' } });
  renderConnectionsResultList(view, list, targetPath, filtered, pinnedSet);

  updateConnectionsProgressBanner(view);
}

export function showConnectionsLoading(view: ConnectionsView, message = 'Loading...'): void {
  view._lastResultKeys = [];
  clearEmbedProgress(view);
  view.container.empty();
  const wrapper = view.container.createDiv({ cls: 'osc-state' });
  wrapper.createDiv({ cls: 'osc-spinner' });
  wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  if (!view.plugin.ready) return;
  new ButtonComponent(wrapper)
    .setButtonText('Refresh')
    .setCta()
    .onClick(async () => {
      await view.plugin.reembedStaleEntities('Connections view refresh');
      void view.renderView();
    });
}

export function showConnectionsEmpty(
  view: ConnectionsView,
  message = 'No similar notes found',
  clear = true,
): void {
  if (clear) {
    view._lastResultKeys = [];
    clearEmbedProgress(view);
    view.container.empty();
  }

  const wrapper = view.container.createDiv({ cls: 'osc-state' });
  const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
  setIcon(iconEl, 'search-x');
  wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  wrapper.createEl('p', {
    text: 'Try writing more content or adjusting minimum character settings.',
    cls: 'osc-state-hint',
  });
  if (!view.plugin.ready) return;
  new ButtonComponent(wrapper)
    .setButtonText('Refresh')
    .setCta()
    .onClick(async () => {
      await view.plugin.reembedStaleEntities('Connections view refresh');
      void view.renderView();
    });
}

export function showConnectionsError(view: ConnectionsView, message = 'An error occurred'): void {
  view._lastResultKeys = [];
  clearEmbedProgress(view);
  view.container.empty();
  const wrapper = view.container.createDiv({ cls: 'osc-state osc-state--error' });
  const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
  setIcon(iconEl, 'alert-circle');
  wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  new ButtonComponent(wrapper)
    .setButtonText('Retry')
    .setCta()
    .onClick(() => { void view.renderView(); });
}
