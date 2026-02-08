/**
 * @file status-bar.ts
 * @description Status bar setup, rendering, and click handling for Smart Connections
 */

import { setIcon } from 'obsidian';
import type SmartConnectionsPlugin from './main';
import { ConnectionsView } from './views/ConnectionsView';

/**
 * Create the status bar item, wire up click handler, and render initial state.
 */
export function setupStatusBar(plugin: SmartConnectionsPlugin): void {
  const app_any = plugin.app as any;
  const status_bar_container: HTMLElement | undefined = app_any?.statusBar?.containerEl;
  if (!status_bar_container) return;

  const existing = status_bar_container.querySelector('.smart-connections-status');
  if (existing) {
    existing.closest('.status-bar-item')?.remove();
  }

  plugin.status_elm = plugin.addStatusBarItem();
  plugin.status_container = plugin.status_elm.createEl('a', {
    cls: 'smart-connections-status',
  });
  setIcon(plugin.status_container, 'network');

  plugin.status_msg = plugin.status_container.createSpan('smart-connections-status-msg');

  plugin.registerDomEvent(plugin.status_container, 'click', () => handleStatusBarClick(plugin));

  refreshStatus(plugin);
}

/**
 * Update the status bar text and tooltip based on current embed state.
 */
export function refreshStatus(plugin: SmartConnectionsPlugin): void {
  if (!plugin.status_msg || !plugin.status_container) return;

  const model = plugin.getCurrentModelInfo();
  const modelTag = `${model.adapter}/${model.modelKey}`;
  const ctx = plugin.current_embed_context;

  switch (plugin.status_state) {
    case 'idle':
      plugin.status_msg.setText('SC: Ready');
      plugin.status_container.setAttribute(
        'title',
        `Smart Connections is ready\nModel: ${modelTag}${model.dims ? ` (${model.dims}d)` : ''}`,
      );
      break;
    case 'loading_model':
      plugin.status_msg.setText('SC: Loading model...');
      plugin.status_container.setAttribute('title', 'Loading embedding model...');
      break;
    case 'embedding': {
      const stats = plugin.embedding_pipeline?.get_stats();
      const current = ctx?.current ?? (stats ? stats.success + stats.failed : 0);
      const total = ctx?.total ?? stats?.total ?? 0;
      plugin.status_msg.setText(`SC: Embedding ${current}/${total} (${modelTag})`);
      const currentNote = ctx?.currentSourcePath ?? '-';
      plugin.status_container.setAttribute(
        'title',
        `Click to stop embedding\nRun: ${ctx?.runId ?? '-'}\nModel: ${modelTag}${model.dims ? ` (${model.dims}d)` : ''}\nCurrent: ${currentNote}`,
      );
      break;
    }
    case 'stopping': {
      const current = ctx?.current ?? 0;
      const total = ctx?.total ?? 0;
      plugin.status_msg.setText(`SC: Stopping ${current}/${total} (${modelTag})`);
      plugin.status_container.setAttribute(
        'title',
        'Stopping after current batch. Click to open Connections view.',
      );
      break;
    }
    case 'paused':
      plugin.status_msg.setText(`SC: Paused (${modelTag})`);
      plugin.status_container.setAttribute(
        'title',
        'Click to resume embedding for queued entities.',
      );
      break;
    case 'error':
      plugin.status_msg.setText('SC: Error');
      plugin.status_container.setAttribute('title', 'Click to open settings');
      break;
  }
}

/**
 * Handle clicks on the status bar item.
 */
export function handleStatusBarClick(plugin: SmartConnectionsPlugin): void {
  switch (plugin.status_state) {
    case 'embedding':
    case 'stopping':
      plugin.requestEmbeddingStop('Status bar click');
      break;
    case 'paused':
      void plugin.resumeEmbedding('Status bar resume');
      break;
    case 'error':
      (plugin.app as any).setting?.open?.();
      break;
    default:
      ConnectionsView.open(plugin.app.workspace);
      break;
  }
}
