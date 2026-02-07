import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../main';

export const CONNECTIONS_VIEW_TYPE = 'smart-connections-view';

/**
 * ConnectionsView - Shows connections for the active note
 * Ported from connections_view.js with TypeScript and Obsidian native components
 */
export class ConnectionsView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  private progressCountEl?: HTMLElement;
  private progressFillEl?: HTMLElement;
  private progressContainerEl?: HTMLElement;
  private stopEmbeddingBtnEl?: HTMLButtonElement;

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

    // Register event to update view when file changes
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (file) this.renderView(file.path);
      }),
    );

    // Register event to update view when embedding is ready
    this.registerEvent(
      this.app.workspace.on('smart-connections:embed-ready' as any, () => {
        this.renderView();
      }),
    );

    // Register event for live embedding progress updates
    this.registerEvent(
      (this.app.workspace as any).on('smart-connections:embed-progress', (data: { current: number; total: number; done?: boolean }) => {
        if (data.done) {
          this.hideEmbeddingProgress();
        } else {
          this.updateEmbeddingProgress(data.current, data.total);
        }
      }),
    );

    // Render initial view
    const active = this.app.workspace.getActiveFile();
    if (active) this.renderView(active.path);
  }

  async onClose(): Promise<void> {
    this.container?.empty();
  }

  /**
   * Render the connections view for a given file path
   */
  async renderView(targetPath?: string): Promise<void> {
    if (!this.container) return;
    if (typeof this.container.checkVisibility === 'function' && !this.container.checkVisibility()) return;

    if (!targetPath) {
      targetPath = this.app.workspace.getActiveFile()?.path;
    }

    if (!targetPath) {
      this.showEmpty('No active file');
      return;
    }

    // Check if core is ready (Phase 1)
    if (!this.plugin.ready || !this.plugin.source_collection) {
      this.showLoading('Smart Connections is initializing...');
      return;
    }

    const source = this.plugin.source_collection.get(targetPath);

    // If source doesn't exist yet
    if (!source) {
      if (!this.plugin.embed_ready) {
        if (this.plugin.status_state === 'error') {
          this.showError('Embedding model failed to initialize. Check Smart Connections settings.');
          return;
        }
        this.showLoading('Smart Connections is loading... Connections will appear when embedding is complete.');
        return;
      }
      this.showEmpty('Source not found. Check exclusion settings.');
      return;
    }

    // If source has no embedding yet
    if (!source.vec) {
      if (!this.plugin.embed_ready) {
        if (this.plugin.status_state === 'error') {
          this.showError('Embedding model failed to initialize. Check Smart Connections settings.');
          return;
        }
        // Show cached connections from AJSON data if possible (other sources may have vecs)
        const cached = this.findCachedConnections(source);
        if (cached.length > 0) {
          this.renderResults(targetPath, cached);
          // Add banner: "Embedding model loading... Results may be incomplete."
          this.addBanner('Embedding model loading... Results may be incomplete.');
          return;
        }
        this.showLoading('Smart Connections is loading... Connections will appear when embedding is complete.');
        return;
      }
      this.showEmpty('No embedding available. The note may be too short or excluded.');
      return;
    }

    // Find and render connections
    try {
      const results = this.plugin.source_collection.nearest_to
        ? await this.plugin.source_collection.nearest_to(source, {})
        : [];
      this.renderResults(targetPath, results);
    } catch (e) {
      this.showError('Failed to find connections: ' + (e as Error).message);
    }
  }

  /**
   * Find cached connections from AJSON data
   */
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

  /**
   * Add a banner message to the view
   */
  private addBanner(message: string): void {
    const banner = this.container.createDiv({ cls: 'osc-banner' });
    banner.createSpan({ text: message, cls: 'osc-banner-text' });
  }

  /**
   * Render connection results
   */
  renderResults(targetPath: string, results: any[]): void {
    this.container.empty();
    const fileName = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';

    // Header with title and actions
    const header = this.container.createDiv({ cls: 'osc-header' });
    header.createSpan({ text: fileName, cls: 'osc-header-title' });

    const actions = header.createDiv({ cls: 'osc-header-actions' });
    const refreshBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    refreshBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
    this.registerDomEvent(refreshBtn, 'click', async () => {
      try {
        // If current source has no vec, queue it and run pipeline
        const source = this.plugin.source_collection?.get(targetPath);
        if (source && !source.vec && this.plugin.embedding_pipeline) {
          source.queue_embed();
          await this.plugin.processInitialEmbedQueue();
        }
      } catch (e) {
        console.error('Failed to refresh embedding:', e);
      }
      this.renderView(targetPath);
    });

    // Embedding progress indicator
    this.renderEmbeddingProgress();

    // Results list
    if (!results || results.length === 0) {
      this.showEmpty('No similar notes found', false);
      return;
    }

    const list = this.container.createDiv({ cls: 'osc-results' });

    for (const result of results) {
      const score = result.score ?? result.sim ?? 0;
      const name = result.item?.path?.split('/').pop()?.replace(/\.md$/, '') ?? 'Unknown';
      const fullPath = result.item?.path ?? '';

      const item = list.createDiv({ cls: 'osc-result-item' });

      // Score badge
      const scoreBadge = item.createSpan({ cls: 'osc-score' });
      const scoreVal = Math.round(score * 100) / 100;
      scoreBadge.setText(scoreVal.toFixed(2));
      if (score >= 0.85) scoreBadge.addClass('osc-score--high');
      else if (score >= 0.7) scoreBadge.addClass('osc-score--medium');
      else scoreBadge.addClass('osc-score--low');

      // Title
      item.createSpan({ text: name, cls: 'osc-result-title' });

      // Click to open
      this.registerDomEvent(item, 'click', (e) => {
        this.plugin.open_note(fullPath, e);
      });

      // Hover preview
      this.registerDomEvent(item, 'mouseover', (e) => {
        this.app.workspace.trigger('hover-link', {
          event: e,
          source: CONNECTIONS_VIEW_TYPE,
          hoverParent: this,
          targetEl: item,
          linktext: fullPath,
        });
      });

      // Drag support
      item.setAttribute('draggable', 'true');
      this.registerDomEvent(item, 'dragstart', (e) => {
        const linkText = fullPath.replace(/\.md$/, '');
        e.dataTransfer?.setData('text/plain', `[[${linkText}]]`);
      });
    }
  }

  /**
   * Render embedding progress indicator
   */
  renderEmbeddingProgress(): void {
    if (!this.plugin.source_collection) return;

    const total = this.plugin.source_collection.size;
    const embedded = this.plugin.source_collection.all.filter(s => s.vec).length;

    if (total > 0 && embedded < total) {
      this.progressContainerEl = this.container.createDiv({ cls: 'osc-embed-progress' });
      const label = this.progressContainerEl.createDiv({ cls: 'osc-embed-progress-label' });
      label.createSpan({ text: 'Embedding vault' });
      this.progressCountEl = label.createSpan({
        text: `${embedded} / ${total}`,
        cls: 'osc-embed-progress-count',
      });

      const track = this.progressContainerEl.createDiv({ cls: 'osc-progress-track' });
      this.progressFillEl = track.createDiv({ cls: 'osc-progress-fill' });
      this.progressFillEl.style.width = `${Math.round((embedded / total) * 100)}%`;

      if (this.plugin.embedding_pipeline?.is_active()) {
        this.stopEmbeddingBtnEl = this.progressContainerEl.createEl('button', {
          text: 'Stop embedding',
          cls: 'osc-btn',
        });
        this.registerDomEvent(this.stopEmbeddingBtnEl, 'click', () => {
          this.plugin.requestEmbeddingStop?.('Connections view stop button');
        });
      }
    }
  }

  updateEmbeddingProgress(current: number, total: number): void {
    if (this.progressCountEl) {
      this.progressCountEl.setText(`${current} / ${total}`);
    }
    if (this.progressFillEl && total > 0) {
      this.progressFillEl.style.width = `${Math.round((current / total) * 100)}%`;
    }
  }

  hideEmbeddingProgress(): void {
    if (this.progressContainerEl) {
      this.progressContainerEl.remove();
      this.progressContainerEl = undefined;
      this.progressCountEl = undefined;
      this.progressFillEl = undefined;
      this.stopEmbeddingBtnEl = undefined;
    }
  }

  /**
   * Show loading state
   */
  showLoading(message = 'Loading...'): void {
    this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.createDiv({ cls: 'osc-spinner' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });

    // Add refresh button if plugin is partially ready
    if (this.plugin.ready) {
      const refreshBtn = wrapper.createEl('button', {
        text: 'Refresh',
        cls: 'osc-btn osc-btn--primary',
      });
      this.registerDomEvent(refreshBtn, 'click', () => this.renderView());
    }
  }

  /**
   * Show empty state
   */
  showEmpty(message = 'No similar notes found', clear = true): void {
    if (clear) this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    wrapper.createEl('p', {
      text: 'Try writing more content or adjusting minimum character settings.',
      cls: 'osc-state-hint',
    });

    // Add refresh button if plugin is ready
    if (this.plugin.ready) {
      const refreshBtn = wrapper.createEl('button', {
        text: 'Refresh',
        cls: 'osc-btn osc-btn--primary',
      });
      this.registerDomEvent(refreshBtn, 'click', () => this.renderView());
    }
  }

  /**
   * Show error state
   */
  showError(message = 'An error occurred'): void {
    this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    const retryBtn = wrapper.createEl('button', {
      text: 'Retry',
      cls: 'osc-btn osc-btn--primary',
    });
    this.registerDomEvent(retryBtn, 'click', () => this.renderView());
  }

  /**
   * Open or reveal the connections view
   */
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

  /**
   * Get the active connections view
   */
  static getView(workspace: any): ConnectionsView | null {
    const leaves = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
    return leaves.length ? leaves[0].view as ConnectionsView : null;
  }
}
