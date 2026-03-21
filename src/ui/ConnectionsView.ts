import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  ButtonComponent,
  Menu,
  setIcon,
} from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import type { ConnectionResult } from '../types/entities';
import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import { showResultContextMenu } from './result-context-menu';
import { getBlockConnections, invalidateConnectionsCache } from './block-connections';

export const CONNECTIONS_VIEW_TYPE = 'smart-connections-view';

/** Persistent pin/hide state stored in plugin data */
interface ConnectionsSessionState {
  pinnedKeys: string[];
  hiddenKeys: string[];
  paused: boolean;
  pausedPath?: string;
}

const EMBED_ERROR_MSG = 'Embedding model failed to initialize. Check Smart Connections settings.';

/**
 * ConnectionsView - Shows connections for the active note
 * Ported from connections_view.js with TypeScript and Obsidian native components
 */
export class ConnectionsView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  private session: ConnectionsSessionState = { pinnedKeys: [], hiddenKeys: [], paused: false };
  private folderFilter: string = '';
  private progressEl: HTMLElement | null = null;
  private lastRenderedPath: string | null = null;
  private autoEmbedRequestedForPath: string | null = null;
  private _renderGen: number = 0;

  constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
    this.loadSession();
  }

  private loadSession(): void {
    const saved = (this.plugin.settings as any)._connections_session;
    if (saved && typeof saved === 'object') {
      this.session = {
        pinnedKeys: saved.pinnedKeys ?? [],
        hiddenKeys: saved.hiddenKeys ?? [],
        paused: saved.paused ?? false,
        pausedPath: saved.pausedPath,
      };
    }
  }

  private async saveSession(): Promise<void> {
    (this.plugin.settings as any)._connections_session = this.session;
    await this.plugin.saveSettings();
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
        if (file && !this.session.paused) void this.renderView(file.path);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('smart-connections:core-ready' as any, () => {
        const file = this.app.workspace.getActiveFile();
        if (file) void this.renderView(file.path);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('smart-connections:embed-ready' as any, () => {
        void this.renderView();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('smart-connections:embed-state-changed' as any, (payload: any) => {
        this.updateProgressBanner();
        // Auto-refresh when embedding finishes and we have a stale view
        if (payload?.event?.type === 'RUN_FINISHED' && this.lastRenderedPath) {
          invalidateConnectionsCache(); // Clear all — embeddings changed
          this.autoEmbedRequestedForPath = null;
          void this.renderView(this.lastRenderedPath);
        }
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
    const gen = ++this._renderGen;
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

    this.lastRenderedPath = targetPath;

    if (!this.plugin.ready || !this.plugin.block_collection) {
      this.showLoading('Smart Connections is initializing...');
      return;
    }

    if (this.plugin.status_state === 'error') {
      this.showError(EMBED_ERROR_MSG);
      return;
    }

    if (!this.plugin.embed_ready) {
      this.showLoading(
        'Smart Connections is loading... Connections will appear when embedding is complete.',
      );
      return;
    }

    // Find blocks belonging to this file
    const allFileBlocks = this.plugin.block_collection.for_source(targetPath);
    const embedded = allFileBlocks.filter(b => b.vec);

    if (embedded.length === 0) {
      if (allFileBlocks.length > 0) {
        // Blocks exist but not yet embedded
        this.autoQueueBlockEmbedding(allFileBlocks);
        this.showLoading('Embedding this note... Results will appear when ready.');
      } else {
        this.showEmpty('No blocks found. The note may be too short or excluded.');
      }
      return;
    }

    try {
      const results = await getBlockConnections(this.plugin.block_collection, targetPath, { limit: 50 });
      if (gen !== this._renderGen) return; // superseded by a newer renderView call
      this.renderResults(targetPath, results);
    } catch (e) {
      this.showError('Failed to find connections: ' + (e as Error).message);
    }
  }

  /**
   * Queue a list of blocks for embedding via the job queue.
   */
  private enqueueBlocksForEmbedding(blocks: EmbeddingBlock[]): void {
    const now = Date.now();
    for (const block of blocks) {
      block.queue_embed();
      if (!block._queue_embed) continue;
      this.plugin.embed_job_queue?.enqueue({
        entityKey: block.key,
        contentHash: block.read_hash || '',
        sourcePath: block.source_key,
        enqueuedAt: now,
      });
    }
  }

  /**
   * Auto-queue unembedded blocks for a file.
   * Fire-and-forget — the view will auto-refresh on RUN_FINISHED.
   */
  private autoQueueBlockEmbedding(blocks: EmbeddingBlock[]): void {
    if (!this.plugin.embed_ready) return;
    const firstKey = blocks[0]?.key;
    if (!firstKey) return;
    if (this.autoEmbedRequestedForPath === firstKey.split('#')[0]) return;
    this.autoEmbedRequestedForPath = firstKey.split('#')[0];
    try {
      this.enqueueBlocksForEmbedding(blocks);
      void this.plugin.runEmbeddingJob('Auto embed blocks for connections view');
    } catch (error) {
      console.warn('[SC] Auto-queue block embedding failed (non-critical):', error);
    }
  }

  private addBanner(message: string): void {
    const banner = this.container.createDiv({ cls: 'osc-banner' });
    banner.createSpan({ text: message, cls: 'osc-banner-text' });
  }

  private updateProgressBanner(): void {
    if (!this.container) return;
    const ctx = this.plugin.current_embed_context;
    const isRunning = this.plugin.status_state === 'embedding' && ctx;

    if (!isRunning) {
      if (this.progressEl) {
        this.progressEl.remove();
        this.progressEl = null;
      }
      return;
    }

    const percent = ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0;
    const text = `Embedding ${ctx.current.toLocaleString()}/${ctx.total.toLocaleString()} (${percent}%)`;

    if (!this.progressEl) {
      this.progressEl = createDiv({ cls: 'osc-embed-progress' });
      this.progressEl.createSpan({ cls: 'osc-embed-progress-text' });
      this.progressEl.createDiv({ cls: 'osc-embed-progress-bar' })
        .createDiv({ cls: 'osc-embed-progress-fill' });
      // Insert at top of container, before header
      this.container.prepend(this.progressEl);
    }

    const textEl = this.progressEl.querySelector('.osc-embed-progress-text') as HTMLElement;
    if (textEl) textEl.setText(text);

    const fillEl = this.progressEl.querySelector('.osc-embed-progress-fill') as HTMLElement;
    if (fillEl) fillEl.style.width = `${percent}%`;
  }

  renderResults(targetPath: string, results: any[]): void {
    this.container.empty();
    this.progressEl = null; // reset reference since container was emptied
    const fileName = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';

    const header = this.container.createDiv({ cls: 'osc-header' });
    header.createSpan({ text: fileName, cls: 'osc-header-title' });

    const actions = header.createDiv({ cls: 'osc-header-actions' });

    // Pause/Play toggle
    const pauseBtn = actions.createEl('button', {
      cls: 'plugin-icon-btn',
      attr: { 'aria-label': this.session.paused ? 'Resume' : 'Pause' },
    });
    setIcon(pauseBtn, this.session.paused ? 'play' : 'pause');
    if (this.session.paused) pauseBtn.addClass('plugin-icon-btn--active');

    this.registerDomEvent(pauseBtn, 'click', () => {
      this.session.paused = !this.session.paused;
      if (this.session.paused) {
        this.session.pausedPath = targetPath;
      } else {
        delete this.session.pausedPath;
        const active = this.app.workspace.getActiveFile();
        if (active) void this.renderView(active.path);
      }
      void this.saveSession();
      setIcon(pauseBtn, this.session.paused ? 'play' : 'pause');
      pauseBtn.toggleClass('plugin-icon-btn--active', this.session.paused);
      pauseBtn.setAttribute('aria-label', this.session.paused ? 'Resume' : 'Pause');
    });

    // Folder filter
    const filterBtn = actions.createEl('button', {
      cls: `plugin-icon-btn${this.folderFilter ? ' plugin-icon-btn--active' : ''}`,
      attr: { 'aria-label': this.folderFilter ? `Filter: ${this.folderFilter}` : 'Filter by folder' },
    });
    setIcon(filterBtn, 'filter');

    this.registerDomEvent(filterBtn, 'click', () => {
      const menu = new Menu();
      menu.addItem((i) =>
        i.setTitle('All folders').setIcon('folder').onClick(() => {
          this.folderFilter = '';
          void this.renderView(targetPath);
        }),
      );

      // Get unique top-level folders from results
      const folders = new Set<string>();
      for (const r of results || []) {
        const sourcePath = (r.item as EmbeddingBlock).source_key ?? r.item.key.split('#')[0] ?? '';
        const parts = sourcePath.split('/');
        if (parts.length > 1) folders.add(parts[0]);
      }
      for (const folder of Array.from(folders).sort()) {
        menu.addItem((i) =>
          i
            .setTitle(folder)
            .setIcon(this.folderFilter === folder ? 'check' : 'folder')
            .onClick(() => {
              this.folderFilter = this.folderFilter === folder ? '' : folder;
              void this.renderView(targetPath);
            }),
        );
      }
      menu.showAtMouseEvent(new MouseEvent('click', { clientX: filterBtn.getBoundingClientRect().left, clientY: filterBtn.getBoundingClientRect().bottom }));
    });

    // Refresh button
    const refreshBtn = actions.createEl('button', {
      cls: 'plugin-icon-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');

    this.registerDomEvent(refreshBtn, 'click', async () => {
      try {
        const fileBlocks = this.plugin.block_collection?.for_source(targetPath) ?? [];
        if (fileBlocks.length > 0) {
          this.enqueueBlocksForEmbedding(fileBlocks);
          await this.plugin.runEmbeddingJob('Connections view refresh');
        }
      } catch (e) {
        console.error('Failed to refresh embedding:', e);
      }
      void this.renderView(targetPath);
    });

    // Results are block results; extract source path for filtering/pinning
    // result.item is a block with source_key = file path
    const getSourcePath = (r: ConnectionResult): string => (r.item as EmbeddingBlock).source_key ?? r.item.key.split('#')[0] ?? '';

    // Filter hidden and by folder
    const filtered = (results || []).filter(r => {
      const sourcePath = getSourcePath(r);
      if (this.session.hiddenKeys.includes(sourcePath)) return false;
      if (this.folderFilter && !sourcePath.startsWith(this.folderFilter + '/')) return false;
      return true;
    });

    if (filtered.length === 0) {
      this.showEmpty('No similar notes found', false);
      return;
    }

    // Sort: pinned first, then by score
    const pinnedSet = new Set(this.session.pinnedKeys);
    filtered.sort((a, b) => {
      const aPinned = pinnedSet.has(getSourcePath(a)) ? 1 : 0;
      const bPinned = pinnedSet.has(getSourcePath(b)) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    const list = this.container.createDiv({ cls: 'osc-results', attr: { role: 'list' } });

    for (const [idx, result] of filtered.entries()) {
      const score = result.score ?? result.sim ?? 0;
      const blockKey: string = (result.item as EmbeddingBlock).key ?? '';
      const fullPath = getSourcePath(result);
      const nameParts = fullPath.replace(/\.md$/, '').split('/');
      const name = nameParts.pop() ?? 'Unknown';
      const breadcrumb = nameParts.length > 0 ? nameParts.join(' / ') : '';
      const isPinned = pinnedSet.has(fullPath);
      const scorePercent = Math.round(score * 100);

      // Extract last heading from block key for subtitle
      const blockParts = blockKey.split('#');
      const lastHeading = blockParts.length > 1 ? blockParts[blockParts.length - 1] : '';

      const item = list.createDiv({
        cls: `osc-result-item${isPinned ? ' osc-result-item--pinned' : ''}`,
        attr: {
          role: 'listitem',
          tabindex: '0',
          'aria-label': `${name} — ${scorePercent}% similarity`,
        },
      });
      item.style.setProperty('--osc-result-delay', `${Math.min(idx * 25, 500)}ms`);

      // Score badge as percentage
      const scoreBadge = item.createSpan({ cls: 'osc-score' });
      scoreBadge.setText(`${scorePercent}%`);
      if (score >= 0.85) scoreBadge.addClass('osc-score--high');
      else if (score >= 0.7) scoreBadge.addClass('osc-score--medium');
      else scoreBadge.addClass('osc-score--low');

      // Content: title + breadcrumb (with heading appended)
      const content = item.createDiv({ cls: 'osc-result-content' });
      content.createSpan({ text: name, cls: 'osc-result-title' });
      const headingSuffix = (lastHeading && !lastHeading.startsWith('paragraph-')) ? lastHeading : '';
      const fullBreadcrumb = [breadcrumb, headingSuffix].filter(Boolean).join(' > ');
      if (fullBreadcrumb) {
        content.createSpan({ text: fullBreadcrumb, cls: 'osc-result-breadcrumb' });
      }

      // Pin indicator
      if (isPinned) {
        const pinIcon = item.createSpan({ cls: 'osc-pin-icon' });
        setIcon(pinIcon, 'pin');
      }

      this.registerDomEvent(item, 'click', async (e) => {
        await this.openBlockResult(fullPath, lastHeading, e);
      });

      this.registerDomEvent(item, 'keydown', (e) => {
        if (e.key === 'Enter') {
          void this.openBlockResult(fullPath, lastHeading);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (item.nextElementSibling as HTMLElement)?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (item.previousElementSibling as HTMLElement)?.focus();
        }
      });

      this.registerDomEvent(item, 'contextmenu', (e) => {
        showResultContextMenu(this.app, fullPath, e, {
          isPinned,
          onPin: () => {
            if (isPinned) {
              this.session.pinnedKeys = this.session.pinnedKeys.filter(k => k !== fullPath);
            } else {
              this.session.pinnedKeys.push(fullPath);
            }
            void this.saveSession();
            void this.renderView(targetPath);
          },
          onHide: () => {
            this.session.hiddenKeys.push(fullPath);
            void this.saveSession();
            void this.renderView(targetPath);
          },
        });
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

    // Show progress banner if embedding is active
    this.updateProgressBanner();
  }

  private async openBlockResult(sourcePath: string, heading: string, event?: MouseEvent): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = (event?.ctrlKey || event?.metaKey)
      ? this.app.workspace.getLeaf('tab')
      : this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(file, heading ? { eState: { subpath: `#${heading}` } } : undefined);
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
