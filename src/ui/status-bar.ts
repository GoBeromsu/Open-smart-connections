/**
 * @file status-bar.ts
 * @description Status bar setup, rendering, and click handling for Smart Connections
 */

import { setIcon } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { ConnectionsView } from './ConnectionsView';

let cachedVaultTag = '';
let cachedIcon = '';
let lastComputeMs = 0;
const CACHE_TTL_MS = 2000;

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

function getVaultTag(plugin: SmartConnectionsPlugin): string {
  const now = Date.now();
  if (now - lastComputeMs < CACHE_TTL_MS && cachedVaultTag) return cachedVaultTag;

  const blocks = plugin.block_collection?.all;
  const totalBlocks = blocks?.length ?? 0;
  const embeddedBlocks = blocks?.filter(b => b.vec)?.length ?? 0;
  const vaultPercent = totalBlocks > 0 ? Math.round((embeddedBlocks / totalBlocks) * 100) : 0;

  cachedVaultTag = `${embeddedBlocks}/${totalBlocks} (${vaultPercent}%)`;
  lastComputeMs = now;
  return cachedVaultTag;
}

function setStatusIcon(plugin: SmartConnectionsPlugin, icon: string): void {
  if (!plugin.status_container || icon === cachedIcon) return;
  setIcon(plugin.status_container, icon);
  cachedIcon = icon;
}

/**
 * Update the status bar text and tooltip based on current embed state.
 */
export function refreshStatus(plugin: SmartConnectionsPlugin): void {
  if (!plugin.status_msg || !plugin.status_container) return;

  if (!plugin.block_collection) {
    setStatusIcon(plugin, 'network');
    plugin.status_msg.setText('SC: Loading...');
    plugin.status_container.setAttribute('title', 'Smart Connections is loading...');
    return;
  }

  const model = plugin.getCurrentModelInfo();
  const modelTag = `${model.adapter}/${model.modelKey}`;
  const ctx = plugin.current_embed_context;
  const vaultTag = getVaultTag(plugin);

  switch (plugin.status_state) {
    case 'idle':
      setStatusIcon(plugin, 'network');
      plugin.status_msg.setText(`SC: ${vaultTag}`);
      plugin.status_container.setAttribute(
        'title',
        `Smart Connections is ready\nEmbedded: ${vaultTag}\nModel: ${modelTag}${model.dims ? ` (${model.dims}d)` : ''}`,
      );
      break;
    case 'embedding': {
      setStatusIcon(plugin, 'loader');
      plugin.status_msg.setText(`SC: ${vaultTag}`);
      const currentNote = ctx?.currentSourcePath ?? '-';
      plugin.status_container.setAttribute(
        'title',
        `Embedding in progress\nProgress: ${vaultTag}\nRun: ${ctx?.runId ?? '-'}\nModel: ${modelTag}${model.dims ? ` (${model.dims}d)` : ''}\nCurrent: ${currentNote}`,
      );
      break;
    }
    case 'error':
      setStatusIcon(plugin, 'alert-triangle');
      plugin.status_msg.setText(`SC: ${vaultTag}`);
      plugin.status_container.setAttribute('title', `Embedding error\nProgress: ${vaultTag}\nClick to open settings`);
      break;
  }
}

/**
 * Handle clicks on the status bar item.
 */
export function handleStatusBarClick(plugin: SmartConnectionsPlugin): void {
  switch (plugin.status_state) {
    case 'error':
      (plugin.app as any).setting?.open?.();
      break;
    default:
      ConnectionsView.open(plugin.app.workspace);
      break;
  }
}
