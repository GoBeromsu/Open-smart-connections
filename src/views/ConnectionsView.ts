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
import { showResultContextMenu } from './result-context-menu';

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
  currentEntityKey: string | null;
  currentSourcePath: string | null;
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
    return 'Smart Connections';
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
      (this.app.workspace as any).on('smart-connections:model-switched', () => {
        this.handleModelSwitched();
      }),
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
    const is_source_stale = !!source?.is_unembedded;
    const kernelState = this.plugin.getEmbeddingKernelState?.();
    const kernelPhase = kernelState?.phase;
    const queuedTotal = kernelState?.queue?.queuedTotal ?? 0;
    const isEmbedActive =
      kernelPhase === 'loading_model' ||
      kernelPhase === 'running' ||
      kernelPhase === 'stopping';
    const isWaitingForReembed = isEmbedActive || queuedTotal > 0;

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

    if (!source.vec || is_source_stale) {
      if (!this.plugin.embed_ready) {
        if (this.plugin.status_state === 'error') {
          this.showError(
            'Embedding model failed to initialize. Check Smart Connections settings.',
          );
          return;
        }
        if (is_source_stale) {
          if (isWaitingForReembed) {
            this.showLoading(
              'Embedding model switched. Re-embedding this note for the active model...',
            );
          } else {
            this.showEmpty('No embedding available. The note may be too short or excluded.');
          }
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
      if (is_source_stale) {
        if (this.plugin.status_state === 'error') {
          this.showError(
            'Embedding model failed to initialize. Check Smart Connections settings.',
          );
          return;
        }
        if (isWaitingForReembed) {
          this.showLoading(
            'Re-embedding this note for the active model. Results will appear when ready.',
          );
        } else {
          this.showEmpty('No embedding available. The note may be too short or excluded.');
        }
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
      this.lastEmbedPayload = undefined;
      void this.renderView();
      return;
    }

    this.updateEmbeddingSession(normalized);
  }

  private handleModelSwitched(): void {
    this.lastEmbedPayload = undefined;
    this.renderEmbeddingSessionCard();
    void this.renderView();
  }

  private shouldShowEmbeddingSessionCard(): boolean {
    return (
      this.plugin.status_state === 'embedding' ||
      this.plugin.status_state === 'stopping' ||
      this.plugin.status_state === 'paused' ||
      this.plugin.status_state === 'error'
    );
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
      currentEntityKey: data.currentEntityKey ?? null,
      currentSourcePath: data.currentSourcePath ?? null,
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
    if (!this.shouldShowEmbeddingSessionCard()) return null;

    const ctx: EmbeddingRunContext | null = this.plugin.getActiveEmbeddingContext?.() ?? null;

    if (ctx && ctx.phase !== 'completed') {
      return {
        runId: ctx.runId,
        phase: ctx.phase,
        current: ctx.current,
        total: ctx.total,
        percent: ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0,
        adapter: ctx.adapter,
        modelKey: ctx.modelKey,
        dims: ctx.dims,
        currentEntityKey: ctx.currentEntityKey,
        currentSourcePath: ctx.currentSourcePath,
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
        currentEntityKey: this.lastEmbedPayload.currentEntityKey ?? null,
        currentSourcePath: this.lastEmbedPayload.currentSourcePath ?? null,
      };
    }

    const total = this.plugin.source_collection?.size ?? 0;
    const embedded =
      this.plugin.source_collection?.all?.filter((item: any) => item.vec)?.length ?? 0;
    const status = this.plugin.status_state;
    let phase: SessionSnapshot['phase'] = 'running';
    if (status === 'stopping') phase = 'stopping';
    else if (status === 'paused') phase = 'paused';
    else if (status === 'error') phase = 'failed';

    return {
      runId: null,
      phase,
      current: embedded,
      total,
      percent: total > 0 ? Math.round((embedded / total) * 100) : 0,
      adapter: this.plugin.settings?.smart_sources?.embed_model?.adapter ?? 'unknown',
      modelKey: this.plugin.embed_model?.model_key ?? 'unknown',
      dims: this.plugin.embed_model?.adapter?.dims ?? null,
      currentEntityKey: null,
      currentSourcePath: null,
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
        .setClass('osc-btn')
        .setClass('osc-btn--session')
        .setButtonText(status === 'stopping' ? 'Stopping...' : 'Stop')
        .setDisabled(status === 'stopping')
        .onClick(() => {
          this.plugin.requestEmbeddingStop?.('Connections view stop button');
        });
    }

    if (status === 'paused') {
      new ButtonComponent(actions)
        .setClass('osc-btn')
        .setClass('osc-btn--session')
        .setCta()
        .setButtonText('Resume')
        .onClick(async () => {
          await this.plugin.resumeEmbedding('Connections view resume');
        });
    }

    new ButtonComponent(actions)
      .setClass('osc-btn')
      .setClass('osc-btn--session')
      .setButtonText('Re-embed')
      .onClick(async () => {
        await this.plugin.reembedStaleEntities('Connections view re-embed');
      });

    new ButtonComponent(actions)
      .setClass('osc-btn')
      .setClass('osc-btn--session')
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
      currentEntityKey: payload.currentEntityKey ?? null,
      currentSourcePath: payload.currentSourcePath ?? null,
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
        `Current: ${snapshot.currentSourcePath ?? snapshot.currentEntityKey ?? '-'}`,
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

    const list = this.container.createDiv({ cls: 'osc-results', attr: { role: 'list' } });

    for (const result of results) {
      const score = result.score ?? result.sim ?? 0;
      const name =
        result.item?.path?.split('/').pop()?.replace(/\.md$/, '') ?? 'Unknown';
      const fullPath = result.item?.path ?? '';

      const item = list.createDiv({
        cls: 'osc-result-item',
        attr: {
          role: 'listitem',
          tabindex: '0',
          'aria-label': `${name} — similarity ${(Math.round(score * 100) / 100).toFixed(2)}`,
        },
      });

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

      this.registerDomEvent(item, 'keydown', (e) => {
        if (e.key === 'Enter') {
          this.plugin.open_note(fullPath);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (item.nextElementSibling as HTMLElement)?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (item.previousElementSibling as HTMLElement)?.focus();
        }
      });

      this.registerDomEvent(item, 'contextmenu', (e) => {
        showResultContextMenu(this.app, fullPath, e);
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
      new ButtonComponent(wrapper)
        .setButtonText('Refresh')
        .setCta()
        .onClick(async () => {
          await this.plugin.reembedStaleEntities('Connections view refresh');
          void this.renderView();
        });
    }
  }

  showEmpty(message = 'No similar notes found', clear = true): void {
    if (clear) this.container.empty();
    if (clear) this.renderEmbeddingSessionCard();

    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
    setIcon(iconEl, 'search-x');
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    wrapper.createEl('p', {
      text: 'Try writing more content or adjusting minimum character settings.',
      cls: 'osc-state-hint',
    });

    if (this.plugin.ready) {
      new ButtonComponent(wrapper)
        .setButtonText('Refresh')
        .setCta()
        .onClick(async () => {
          await this.plugin.reembedStaleEntities('Connections view refresh');
          void this.renderView();
        });
    }
  }

  showError(message = 'An error occurred'): void {
    this.container.empty();
    this.renderEmbeddingSessionCard();

    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
    setIcon(iconEl, 'alert-circle');
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    new ButtonComponent(wrapper)
      .setButtonText('Retry')
      .setCta()
      .onClick(() => { void this.renderView(); });
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
