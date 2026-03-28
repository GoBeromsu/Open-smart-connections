import { ItemView, Workspace, WorkspaceLeaf, TFile } from 'obsidian';

import type SmartConnectionsPlugin from '../main';
import type { ConnectionResult } from '../types/entities';
import { applyConnectionsViewState, deriveConnectionsViewState, scheduleConnectionsRetry } from './connections-view-state';
import {
  cancelPendingRetry,
  clearEmbedProgress,
  handleConnectionsModelSwitched,
  updateConnectionsProgressBanner,
} from './connections-view-progress';
import {
  ConnectionsSessionState,
  loadConnectionsSession,
  saveConnectionsSession,
} from './connections-view-session';
import {
  clearAutoEmbedTimeout,
  enqueueBlocksForEmbedding,
} from './connections-view-auto-embed';
import {
  openConnectionsBlockResult,
  renderConnectionsResults,
  showConnectionsEmpty,
  showConnectionsError,
  showConnectionsLoading,
} from './connections-view-results';
import { invalidateConnectionsCache } from './block-connections';

export const CONNECTIONS_VIEW_TYPE = 'open-connections-view';

export class ConnectionsView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  session: ConnectionsSessionState = { pinnedKeys: [], hiddenKeys: [], paused: false };
  folderFilter = '';
  embedProgress: { update(): void; destroy(): void } | null = null;
  lastRenderedPath: string | null = null;
  autoEmbedRequestedForPath: string | null = null;
  _autoEmbedTimeout: number | null = null;
  _needsRefresh = false;
  _renderGen = 0;
  lastRenderFingerprint: string | null = null;
  _lastResultKeys: string[] = [];
  _pendingRetry: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
    loadConnectionsSession(this);
  }

  getViewType(): string { return CONNECTIONS_VIEW_TYPE; }
  getDisplayText(): string { return 'Open connections'; }
  getIcon(): string { return 'network'; }

  async onOpen(): Promise<void> {
    const contentEl = this.containerEl.children[1];
    if (!(contentEl instanceof HTMLElement)) return;
    contentEl.empty();
    this.container = contentEl;
    this.container.addClass('osc-connections-view');

    this.registerEvent(this.app.workspace.on('file-open', (file: TFile | null) => {
      if (file && !this.session.paused) void this.renderView(file.path);
    }));
    this.registerEvent(this.app.workspace.on('open-connections:core-ready', () => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.renderView(file.path);
    }));
    this.registerEvent(this.app.workspace.on('open-connections:embed-ready', () => {
      void this.renderView();
    }));
    this.registerEvent(this.app.workspace.on('open-connections:model-switched', () => {
      this.handleModelSwitched();
    }));
    this.registerEvent(this.app.workspace.on('open-connections:embed-state-changed', (payload) => {
      this.updateProgressBanner();
      if (payload?.prev === 'running' && payload?.phase === 'idle' && this.lastRenderedPath) {
        invalidateConnectionsCache();
        this.autoEmbedRequestedForPath = null;
        this.clearAutoEmbedTimeout();
        void this.renderView(this.lastRenderedPath);
      }
    }));
    this.registerEvent(this.app.workspace.on('open-connections:embed-progress', () => {
      this.updateProgressBanner();
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if (this._needsRefresh && typeof this.container?.checkVisibility === 'function' && this.container.checkVisibility()) {
        this._needsRefresh = false;
        void this.renderView(this.lastRenderedPath ?? undefined);
      }
    }));

    const active = this.app.workspace.getActiveFile();
    if (active) await this.renderView(active.path);
  }

  onClose(): Promise<void> {
    this.clearAutoEmbedTimeout();
    this.cancelPendingRetry();
    this.clearEmbedProgress();
    this.container?.empty();
    return Promise.resolve();
  }

  async renderView(targetPath?: string): Promise<void> {
    const gen = ++this._renderGen;
    if (!this.container) return;
    if (typeof this.container.checkVisibility === 'function' && !this.container.checkVisibility()) {
      this._needsRefresh = true;
      return;
    }

    targetPath = targetPath ?? this.app.workspace.getActiveFile()?.path;
    if (!targetPath) {
      applyConnectionsViewState(this, { type: 'idle' });
      return;
    }
    this.lastRenderedPath = targetPath;

    try {
      const state = await this.deriveViewState(targetPath);
      if (this.scheduleRetryIfStale(gen)) return;
      this.applyViewState(state);
      this.updateProgressBanner();
    } catch (error) {
      if (this.scheduleRetryIfStale(gen)) return;
      this.showError('Failed to find connections: ' + (error as Error).message);
      this.updateProgressBanner();
    }
  }

  showLoading(message = 'Loading...'): void { showConnectionsLoading(this, message); }
  showEmpty(message = 'No similar notes found', clear = true): void { showConnectionsEmpty(this, message, clear); }
  showError(message = 'An error occurred'): void { showConnectionsError(this, message); }
  renderResults(targetPath: string, results: ConnectionResult[]): void { renderConnectionsResults(this, targetPath, results); }

  static open(workspace: Workspace): void {
    const existingLeaf = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE)[0];
    if (existingLeaf) {
      void workspace.revealLeaf(existingLeaf);
    } else {
      void workspace.getRightLeaf(false)?.setViewState({ type: CONNECTIONS_VIEW_TYPE, active: true });
    }
  }

  static getView(workspace: Workspace): ConnectionsView | null {
    const leaf = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE)[0];
    return leaf ? (leaf.view as ConnectionsView) : null;
  }

  async saveSession(): Promise<void> { await saveConnectionsSession(this); }
  async deriveViewState(targetPath: string) { return deriveConnectionsViewState(this, targetPath); }
  applyViewState(state: Awaited<ReturnType<typeof deriveConnectionsViewState>>): void { applyConnectionsViewState(this, state); }
  scheduleRetryIfStale(gen: number): boolean { return scheduleConnectionsRetry(this, gen); }
  enqueueBlocksForEmbedding(blocks: Parameters<typeof enqueueBlocksForEmbedding>[0]): void { enqueueBlocksForEmbedding(blocks); }
  clearAutoEmbedTimeout(): void { clearAutoEmbedTimeout(this); }
  cancelPendingRetry(): void { cancelPendingRetry(this); }
  clearEmbedProgress(): void { clearEmbedProgress(this); }
  handleModelSwitched(): void { handleConnectionsModelSwitched(this); }
  updateProgressBanner(): void { updateConnectionsProgressBanner(this); }
  async openBlockResult(sourcePath: string, heading: string, event?: MouseEvent): Promise<void> {
    await openConnectionsBlockResult(this, sourcePath, heading, event);
  }
}
