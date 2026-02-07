import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  ButtonComponent,
  ProgressBarComponent,
  setIcon,
} from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import type { EmbeddingRunContext, EmbedProgressEventPayload } from '../main';

export const CONNECTIONS_VIEW_TYPE = 'smart-connections-view';

type EmbedProgressLike = Partial<EmbedProgressEventPayload> & {
  current: number;
  total: number;
  done?: boolean;
};

interface SessionSnapshot {
  runId: number | null;
  phase: 'running' | 'stopping' | 'paused' | 'completed' | 'failed';
  current: number;
  total: number;
  percent: number;
  adapter: string;
  modelKey: string;
  dims: number | null;
  sourceDataDir: string;
  blockDataDir: string;
}

/**
 * ConnectionsView - Shows connections for the active note
 * Ported from connections_view.js with TypeScript and Obsidian native components
 */
export class ConnectionsView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  private sessionCardEl?: HTMLElement;
  private sessionStatusBadgeEl?: HTMLElement;
  private sessionProgressTextEl?: HTMLElement;
  private sessionModelTextEl?: HTMLElement;
  private sessionStorageTextEl?: HTMLElement;
  private sessionProgressBar?: ProgressBarComponent;
  private lastEmbedPayload?: EmbedProgressEventPayload;

  constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return CONNECTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Connections';
  }

  getIcon(): string {
    return 'network';
  }

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.container = this.containerEl.children[1] as HTMLElement;
    this.container.addClass('osc-connections-view');

    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (file) void this.renderView(file.path);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('smart-connections:embed-ready' as any, () => {
        void this.renderView();
      }),
    );

    this.registerEvent(
      (this.app.workspace as any).on(
        'smart-connections:embed-progress',
        (data: EmbedProgressLike) => {
          this.handleEmbedProgressEvent(data);
        },
      ),
    );

    this.registerEvent(
      (this.app.workspace as any).on('smart-connections:settings-changed', () => {
        this.renderEmbeddingSessionCard();
      }),
    );

    const active = this.app.workspace.getActiveFile();
    if (active) {
      await this.renderView(active.path);
    }
  }

  async onClose(): Promise<void> {
    this.container?.empty();
  }

  async renderView(targetPath?: string): Promise<void> {
    if (!this.container) return;
    if (
      typeof this.container.checkVisibility === 'function' &&
      !this.container.checkVisibility()
    ) {
      return;
    }

    if (!targetPath) {
      targetPath = this.app.workspace.getActiveFile()?.path;
    }

    if (!targetPath) {
      this.showEmpty('No active file');
      return;
    }

    if (!this.plugin.ready || !this.plugin.source_collection) {
      this.showLoading('Smart Connections is initializing...');
      return;
    }

    const source = this.plugin.source_collection.get(targetPath);

    if (!source) {
      if (!this.plugin.embed_ready) {
        if (this.plugin.status_state === 'error') {
          this.showError(
            'Embedding model failed to initialize. Check Smart Connections settings.',
          );
          return;
        }
        this.showLoading(
          'Smart Connections is loading... Connections will appear when embedding is complete.',
        );
        return;
      }
      this.showEmpty('Source not found. Check exclusion settings.');
      return;
    }

    if (!source.vec) {
      if (!this.plugin.embed_ready) {
        if (this.plugin.status_state === 'error') {
          this.showError(
            'Embedding model failed to initialize. Check Smart Connections settings.',
          );
          return;
        }
        const cached = this.findCachedConnections(source);
        if (cached.length > 0) {
          this.renderResults(targetPath, cached);
          this.addBanner('Embedding model loading... Results may be incomplete.');
          return;
        }
        this.showLoading(
          'Smart Connections is loading... Connections will appear when embedding is complete.',
        );
        return;
      }
      this.showEmpty('No embedding available. The note may be too short or excluded.');
      return;
    }

    try {
      const results = this.plugin.source_collection.nearest_to
        ? await this.plugin.source_collection.nearest_to(source, {})
        : [];
      this.renderResults(targetPath, results);
    } catch (e) {
      this.showError('Failed to find connections: ' + (e as Error).message);
    }
  }

  private handleEmbedProgressEvent(data: EmbedProgressLike): void {
    const normalized = this.normalizeEmbedProgress(data);
    this.lastEmbedPayload = normalized;

    if (normalized.done) {
      void this.renderView();
      return;
    }

    this.updateEmbeddingSession(normalized);
  }

  private normalizeEmbedProgress(data: EmbedProgressLike): EmbedProgressEventPayload {
    const ctx = this.plugin.getActiveEmbeddingContext?.();
    const current = data.current ?? ctx?.current ?? 0;
    const total = data.total ?? ctx?.total ?? 0;
    const percent =
      typeof data.percent === 'number'
        ? data.percent
        : total > 0
          ? Math.round((current / total) * 100)
          : 0;

    return {
      runId: data.runId ?? ctx?.runId ?? 0,
      phase: (data.phase as EmbedProgressEventPayload['phase']) ?? ctx?.phase ?? 'running',
      reason: data.reason ?? ctx?.reason ?? 'Embedding run',
      adapter:
        data.adapter ??
        this.plugin.settings?.smart_sources?.embed_model?.adapter ??
        'unknown',
      modelKey: data.modelKey ?? this.plugin.embed_model?.model_key ?? 'unknown',
      dims: data.dims ?? this.plugin.embed_model?.adapter?.dims ?? null,
      current,
      total,
      percent,
      sourceTotal: data.sourceTotal ?? 0,
      blockTotal: data.blockTotal ?? 0,
      saveCount: data.saveCount ?? 0,
      sourceDataDir: data.sourceDataDir ?? this.plugin.source_collection?.data_dir ?? '-',
      blockDataDir: data.blockDataDir ?? this.plugin.block_collection?.data_dir ?? '-',
      startedAt: data.startedAt ?? Date.now(),
      elapsedMs: data.elapsedMs ?? 0,
      etaMs: data.etaMs ?? null,
      done: data.done,
      error: data.error,
    };
  }

  private getSessionSnapshot(): SessionSnapshot | null {
    const ctx: EmbeddingRunContext | null = this.plugin.getActiveEmbeddingContext?.() ?? null;

    if (ctx) {
      return {
        runId: ctx.runId,
        phase: ctx.phase,
        current: ctx.current,
        total: ctx.total,
        percent: ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0,
        adapter: ctx.adapter,
        modelKey: ctx.modelKey,
        dims: ctx.dims,
        sourceDataDir: ctx.sourceDataDir,
        blockDataDir: ctx.blockDataDir,
      };
    }

    if (this.lastEmbedPayload && !this.lastEmbedPayload.done) {
      return {
        runId: this.lastEmbedPayload.runId,
        phase: this.lastEmbedPayload.phase,
        current: this.lastEmbedPayload.current,
        total: this.lastEmbedPayload.total,
        percent: this.lastEmbedPayload.percent,
        adapter: this.lastEmbedPayload.adapter,
        modelKey: this.lastEmbedPayload.modelKey,
        dims: this.lastEmbedPayload.dims,
        sourceDataDir: this.lastEmbedPayload.sourceDataDir,
        blockDataDir: this.lastEmbedPayload.blockDataDir,
      };
    }

    const total = this.plugin.source_collection?.size ?? 0;
    const embedded =
      this.plugin.source_collection?.all?.filter((item: any) => item.vec)?.length ?? 0;
    const pending = total - embedded;

    if (
      pending <= 0 &&
      !['loading_model', 'embedding', 'stopping', 'paused', 'error'].includes(
        this.plugin.status_state,
      )
    ) {
      return null;
    }

    return {
      runId: null,
      phase:
        this.plugin.status_state === 'stopping'
          ? 'stopping'
          : this.plugin.status_state === 'paused'
            ? 'paused'
            : this.plugin.status_state === 'error'
              ? 'failed'
              : 'running',
      current: embedded,
      total,
      percent: total > 0 ? Math.round((embedded / total) * 100) : 0,
      adapter: this.plugin.settings?.smart_sources?.embed_model?.adapter ?? 'unknown',
      modelKey: this.plugin.embed_model?.model_key ?? 'unknown',
      dims: this.plugin.embed_model?.adapter?.dims ?? null,
      sourceDataDir: this.plugin.source_collection?.data_dir ?? '-',
      blockDataDir: this.plugin.block_collection?.data_dir ?? '-',
    };
  }

  private renderEmbeddingSessionCard(): void {
    if (!this.container) return;

    if (this.sessionCardEl) {
      this.sessionCardEl.remove();
      this.sessionCardEl = undefined;
      this.sessionStatusBadgeEl = undefined;
      this.sessionProgressTextEl = undefined;
      this.sessionModelTextEl = undefined;
      this.sessionStorageTextEl = undefined;
      this.sessionProgressBar = undefined;
    }

    const snapshot = this.getSessionSnapshot();
    if (!snapshot) return;

    this.sessionCardEl = this.container.createDiv({ cls: 'osc-embed-session' });

    const header = this.sessionCardEl.createDiv({ cls: 'osc-embed-session-header' });
    const titleWrap = header.createDiv({ cls: 'osc-embed-session-title-wrap' });
    const iconEl = titleWrap.createSpan({ cls: 'osc-embed-session-icon' });
    setIcon(iconEl, 'network');
    titleWrap.createSpan({ text: 'Embedding session', cls: 'osc-embed-session-title' });

    this.sessionStatusBadgeEl =
      header.createSpan({ cls: 'osc-embed-session-status-badge' });

    this.sessionModelTextEl = this.sessionCardEl.createDiv({
      cls: 'osc-embed-session-model',
    });

    this.sessionProgressTextEl = this.sessionCardEl.createDiv({
      cls: 'osc-embed-session-progress',
    });

    const progressWrap = this.sessionCardEl.createDiv({
      cls: 'osc-embed-session-progressbar',
    });
    this.sessionProgressBar = new ProgressBarComponent(progressWrap);
    this.sessionProgressBar.setValue(snapshot.percent);

    this.sessionStorageTextEl = this.sessionCardEl.createDiv({
      cls: 'osc-embed-session-storage',
    });

    const actions = this.sessionCardEl.createDiv({ cls: 'osc-embed-session-actions' });

    const status = this.plugin.status_state;
    if (status === 'embedding' || status === 'stopping') {
      new ButtonComponent(actions)
        .setClass('osc-btn osc-btn--session')
        .setButtonText(status === 'stopping' ? 'Stopping...' : 'Stop')
        .setDisabled(status === 'stopping')
        .onClick(() => {
          this.plugin.requestEmbeddingStop?.('Connections view stop button');
        });
    }

    if (status === 'paused') {
      new ButtonComponent(actions)
        .setClass('osc-btn osc-btn--session')
        .setCta()
        .setButtonText('Resume')
        .onClick(async () => {
          await this.plugin.resumeEmbedding('Connections view resume');
        });
    }

    new ButtonComponent(actions)
      .setClass('osc-btn osc-btn--session')
      .setButtonText('Re-embed')
      .onClick(async () => {
        await this.plugin.reembedStaleEntities('Connections view re-embed');
      });

    new ButtonComponent(actions)
      .setClass('osc-btn osc-btn--session')
      .setButtonText('Settings')
      .onClick(() => {
        (this.app as any).setting?.open?.();
      });

    this.updateSessionCardFromSnapshot(snapshot);
  }

  private updateEmbeddingSession(payload: EmbedProgressEventPayload): void {
    if (!this.sessionCardEl) {
      this.renderEmbeddingSessionCard();
      return;
    }

    const snapshot: SessionSnapshot = {
      runId: payload.runId,
      phase: payload.phase,
      current: payload.current,
      total: payload.total,
      percent: payload.percent,
      adapter: payload.adapter,
      modelKey: payload.modelKey,
      dims: payload.dims,
      sourceDataDir: payload.sourceDataDir,
      blockDataDir: payload.blockDataDir,
    };

    this.updateSessionCardFromSnapshot(snapshot);
  }

  private updateSessionCardFromSnapshot(snapshot: SessionSnapshot): void {
    if (this.sessionStatusBadgeEl) {
      this.sessionStatusBadgeEl.className = 'osc-embed-session-status-badge';
      this.sessionStatusBadgeEl.addClass(`osc-embed-session-status--${snapshot.phase}`);
      this.sessionStatusBadgeEl.setText(this.getPhaseLabel(snapshot.phase));
    }

    if (this.sessionModelTextEl) {
      const dimsText = snapshot.dims ? ` (${snapshot.dims}d)` : '';
      this.sessionModelTextEl.setText(
        `Model: ${snapshot.adapter}/${snapshot.modelKey}${dimsText}${snapshot.runId ? `  •  Run #${snapshot.runId}` : ''}`,
      );
    }

    if (this.sessionProgressTextEl) {
      this.sessionProgressTextEl.setText(
        `Progress: ${snapshot.current}/${snapshot.total} (${snapshot.percent}%)`,
      );
    }

    this.sessionProgressBar?.setValue(snapshot.percent);

    if (this.sessionStorageTextEl) {
      this.sessionStorageTextEl.setText(
        `Storage: ${snapshot.sourceDataDir}${snapshot.blockDataDir ? ` | ${snapshot.blockDataDir}` : ''}`,
      );
    }
  }

  private getPhaseLabel(phase: SessionSnapshot['phase']): string {
    switch (phase) {
      case 'running':
        return 'Running';
      case 'stopping':
        return 'Stopping';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Error';
      default:
        return 'Running';
    }
  }

  private findCachedConnections(source: any): any[] {
    if (!source.vec || !this.plugin.source_collection) return [];
    try {
      return this.plugin.source_collection.nearest(source.vec, {
        exclude: [source.key],
      });
    } catch {
      return [];
    }
  }

  private addBanner(message: string): void {
    const banner = this.container.createDiv({ cls: 'osc-banner' });
    banner.createSpan({ text: message, cls: 'osc-banner-text' });
  }

  renderResults(targetPath: string, results: any[]): void {
    this.container.empty();
    const fileName = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';

    const header = this.container.createDiv({ cls: 'osc-header' });
    header.createSpan({ text: fileName, cls: 'osc-header-title' });

    const actions = header.createDiv({ cls: 'osc-header-actions' });
    const refreshBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');

    this.registerDomEvent(refreshBtn, 'click', async () => {
      try {
        const source = this.plugin.source_collection?.get(targetPath);
        if (source && !source.vec) {
          source.queue_embed();
          await this.plugin.runEmbeddingJob('Connections view refresh');
        }
      } catch (e) {
        console.error('Failed to refresh embedding:', e);
      }
      void this.renderView(targetPath);
    });

    this.renderEmbeddingSessionCard();

    if (!results || results.length === 0) {
      this.showEmpty('No similar notes found', false);
      return;
    }

    const list = this.container.createDiv({ cls: 'osc-results' });

    for (const result of results) {
      const score = result.score ?? result.sim ?? 0;
      const name =
        result.item?.path?.split('/').pop()?.replace(/\.md$/, '') ?? 'Unknown';
      const fullPath = result.item?.path ?? '';

      const item = list.createDiv({ cls: 'osc-result-item' });

      const scoreBadge = item.createSpan({ cls: 'osc-score' });
      const scoreVal = Math.round(score * 100) / 100;
      scoreBadge.setText(scoreVal.toFixed(2));
      if (score >= 0.85) scoreBadge.addClass('osc-score--high');
      else if (score >= 0.7) scoreBadge.addClass('osc-score--medium');
      else scoreBadge.addClass('osc-score--low');

      item.createSpan({ text: name, cls: 'osc-result-title' });

      this.registerDomEvent(item, 'click', (e) => {
        this.plugin.open_note(fullPath, e);
      });

      this.registerDomEvent(item, 'mouseover', (e) => {
        this.app.workspace.trigger('hover-link', {
          event: e,
          source: CONNECTIONS_VIEW_TYPE,
          hoverParent: this,
          targetEl: item,
          linktext: fullPath,
        });
      });

      item.setAttribute('draggable', 'true');
      this.registerDomEvent(item, 'dragstart', (e) => {
        const linkText = fullPath.replace(/\.md$/, '');
        e.dataTransfer?.setData('text/plain', `[[${linkText}]]`);
      });
    }
  }

  showLoading(message = 'Loading...'): void {
    this.container.empty();
    this.renderEmbeddingSessionCard();

    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.createDiv({ cls: 'osc-spinner' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });

    if (this.plugin.ready) {
      const refreshBtn = wrapper.createEl('button', {
        text: 'Refresh',
        cls: 'osc-btn osc-btn--primary',
      });
      this.registerDomEvent(refreshBtn, 'click', () => {
        void this.renderView();
      });
    }
  }

  showEmpty(message = 'No similar notes found', clear = true): void {
    if (clear) this.container.empty();
    if (clear) this.renderEmbeddingSessionCard();

    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    wrapper.createEl('p', {
      text: 'Try writing more content or adjusting minimum character settings.',
      cls: 'osc-state-hint',
    });

    if (this.plugin.ready) {
      const refreshBtn = wrapper.createEl('button', {
        text: 'Refresh',
        cls: 'osc-btn osc-btn--primary',
      });
      this.registerDomEvent(refreshBtn, 'click', () => {
        void this.renderView();
      });
    }
  }

  showError(message = 'An error occurred'): void {
    this.container.empty();
    this.renderEmbeddingSessionCard();

    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    wrapper.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    const retryBtn = wrapper.createEl('button', {
      text: 'Retry',
      cls: 'osc-btn osc-btn--primary',
    });
    this.registerDomEvent(retryBtn, 'click', () => {
      void this.renderView();
    });
  }

  static open(workspace: any): void {
    const existing = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
    if (existing.length) {
      workspace.revealLeaf(existing[0]);
    } else {
      workspace.getRightLeaf(false)?.setViewState({
        type: CONNECTIONS_VIEW_TYPE,
        active: true,
      });
    }
  }

  static getView(workspace: any): ConnectionsView | null {
    const leaves = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
    return leaves.length ? (leaves[0].view as ConnectionsView) : null;
  }
}
