import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  ButtonComponent,
  setIcon,
} from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { showResultContextMenu } from './result-context-menu';

export const CONNECTIONS_VIEW_TYPE = 'smart-connections-view';

/**
 * ConnectionsView - Shows connections for the active note
 * Ported from connections_view.js with TypeScript and Obsidian native components
 */
export class ConnectionsView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;

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
    const isEmbedActive = kernelPhase === 'running';
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
          this.plugin.embed_job_queue?.enqueue({
            entityKey: source.key,
            contentHash: source.read_hash || '',
            sourcePath: source.key.split('#')[0],
            enqueuedAt: Date.now(),
          });
          await this.plugin.runEmbeddingJob('Connections view refresh');
        }
      } catch (e) {
        console.error('Failed to refresh embedding:', e);
      }
      void this.renderView(targetPath);
    });

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
