import { ItemView, WorkspaceLeaf, ButtonComponent, debounce, setIcon, Platform } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { lookup } from '../../core/search/lookup';
import type { LookupOptions } from '../../core/search/lookup';
import { showResultContextMenu } from './result-context-menu';

export const LOOKUP_VIEW_TYPE = 'smart-connections-lookup';

type LookupFilter = 'all' | 'notes' | 'blocks';
type ScoreTier = 'high' | 'medium' | 'low';

function scoreTierFor(score: number): ScoreTier {
  if (score >= 0.85) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

export class LookupView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  searchInput: HTMLInputElement;
  resultsContainer: HTMLElement;
  activeFilter: LookupFilter = 'all';
  filterChipsEl: HTMLElement;
  searchMetaEl: HTMLElement;
  lastQuery = '';
  clearBtn: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return LOOKUP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Smart Lookup';
  }

  getIcon(): string {
    return 'search';
  }

  /* ─── Helper Methods ─── */

  private getActiveCollections(): any[] {
    const collections: any[] = [];
    if (this.activeFilter !== 'blocks' && this.plugin.source_collection) {
      collections.push(this.plugin.source_collection);
    }
    if (this.activeFilter !== 'notes' && this.plugin.block_collection) {
      collections.push(this.plugin.block_collection);
    }
    return collections;
  }

  private getEntities(): any[] {
    const entities: any[] = [];
    for (const collection of this.getActiveCollections()) {
      for (const entity of collection.all) {
        if (entity.vec && !entity.is_unembedded) entities.push(entity);
      }
    }
    return entities;
  }

  private getEntityCount(): number {
    let count = 0;
    for (const collection of this.getActiveCollections()) {
      count += collection.all.length;
    }
    return count;
  }

  private formatPath(key: string): string {
    const filePath = key.split('#')[0];
    const parts = filePath.replace(/\.md$/, '').split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join(' > ');
  }

  private formatBlockIndicator(key: string): string {
    const hashIdx = key.indexOf('#');
    if (hashIdx === -1) return '';
    return key.substring(hashIdx + 1).replace(/#/g, ' > ');
  }

  private formatTitle(key: string): string {
    const parts = key.split('/');
    const filename = parts.pop() ?? 'Unknown';
    return filename.replace(/\.md$/, '').replace(/#/g, ' > ');
  }

  private setActiveFilter(filter: LookupFilter): void {
    this.activeFilter = filter;
    this.filterChipsEl?.querySelectorAll('.osc-lookup-chip').forEach((chip) => {
      (chip as HTMLElement).toggleClass('osc-lookup-chip--active', (chip as HTMLElement).dataset.filter === filter);
    });
    if (this.lastQuery) {
      this.performSearch(this.lastQuery);
    }
  }

  private updateClearButton(): void {
    this.clearBtn?.toggleClass('osc-lookup-clear-btn--visible', this.searchInput.value.length > 0);
  }

  private clearSearch(): void {
    this.searchInput.value = '';
    this.lastQuery = '';
    this.updateClearButton();
    this.searchMetaEl?.empty();
    this.showEmpty('Type a query to search your notes semantically');
  }

  /* ─── Lifecycle ─── */

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.container = this.containerEl.children[1] as HTMLElement;
    this.container.addClass('osc-lookup-view');

    // Search wrapper
    const searchWrapper = this.container.createDiv({ cls: 'osc-lookup-search-wrapper' });

    const searchIconEl = searchWrapper.createDiv({ cls: 'osc-lookup-search-icon' });
    setIcon(searchIconEl, 'search');

    this.searchInput = searchWrapper.createEl('input', {
      type: 'text',
      placeholder: 'Search notes semantically...',
      cls: 'osc-lookup-input',
    });

    this.clearBtn = searchWrapper.createEl('button', {
      cls: 'osc-lookup-clear-btn',
      attr: { 'aria-label': 'Clear search' },
    });
    setIcon(this.clearBtn, 'x');

    // Filter chips
    this.filterChipsEl = this.container.createDiv({ cls: 'osc-lookup-filters' });
    const filters: { key: LookupFilter; label: string }[] = [
      { key: 'all', label: 'All' },
      { key: 'notes', label: 'Notes' },
      { key: 'blocks', label: 'Blocks' },
    ];
    for (const f of filters) {
      const chip = this.filterChipsEl.createEl('button', {
        text: f.label,
        cls: `osc-lookup-chip${f.key === 'all' ? ' osc-lookup-chip--active' : ''}`,
        attr: { 'data-filter': f.key },
      });
      this.registerDomEvent(chip, 'click', () => this.setActiveFilter(f.key));
    }

    // Meta line
    this.searchMetaEl = this.container.createDiv({ cls: 'osc-lookup-meta' });

    // Results area
    this.resultsContainer = this.container.createDiv({ cls: 'osc-lookup-results' });

    // --- Events ---

    const debouncedSearch = debounce(
      (query: string) => this.performSearch(query),
      500,
      true,
    );

    this.registerDomEvent(this.searchInput, 'input', () => {
      this.updateClearButton();
      debouncedSearch(this.searchInput.value);
    });

    this.registerDomEvent(this.searchInput, 'keydown', (e) => {
      if (e.key === 'Enter') {
        this.performSearch(this.searchInput.value);
      } else if (e.key === 'Escape') {
        this.clearSearch();
      }
    });

    this.registerDomEvent(this.clearBtn, 'click', () => {
      this.clearSearch();
      this.searchInput.focus();
    });

    this.registerEvent(
      (this.app.workspace as any).on('smart-connections:model-switched', () => {
        this.handleModelSwitched();
      }),
    );

    this.showEmpty('Type a query to search your notes semantically');
    this.searchInput.focus();
  }

  async onClose(): Promise<void> {
    this.container?.empty();
  }

  /* ─── Search ─── */

  async performSearch(query: string): Promise<void> {
    if (!query.trim()) {
      this.clearSearch();
      return;
    }

    this.lastQuery = query;

    if (!this.plugin.embed_ready || !this.plugin.embed_model) {
      this.showLoading('Embedding model is still loading...');
      return;
    }

    this.showLoading(`Searching across ${this.getEntityCount()} items...`);

    const startTime = performance.now();

    try {
      const entities = this.getEntities();

      if (entities.length === 0) {
        this.showEmpty('No embedded notes found. Wait for embedding to complete.');
        return;
      }

      const opts: LookupOptions = {
        limit: 20,
        sources_only: this.activeFilter === 'notes',
        blocks_only: this.activeFilter === 'blocks',
      };

      const results = await lookup(
        query,
        this.plugin.embed_model.adapter,
        entities,
        opts,
      );

      const elapsedMs = Math.round(performance.now() - startTime);
      this.renderResults(query, results, elapsedMs);
    } catch (e) {
      this.showError('Search failed: ' + (e as Error).message);
    }
  }

  private handleModelSwitched(): void {
    if (!this.resultsContainer) return;
    this.showEmpty(
      'Embedding model changed. Results will refresh after active-model embeddings are ready.',
    );
  }

  /* ─── Rendering ─── */

  renderResults(query: string, results: any[], elapsedMs?: number): void {
    this.resultsContainer.empty();

    if (!results || results.length === 0) {
      this.showEmpty('No results found for "' + query + '"', false);
      return;
    }

    // Meta line
    if (this.searchMetaEl) {
      this.searchMetaEl.empty();
      const parts = [`${results.length} result${results.length === 1 ? '' : 's'}`];
      if (elapsedMs !== undefined) parts.push(`${elapsedMs}ms`);
      this.searchMetaEl.setText(parts.join(' \u00b7 '));
    }

    const list = this.resultsContainer.createDiv({
      cls: 'osc-results',
      attr: { role: 'list' },
    });

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const score = result.score ?? result.sim ?? 0;
      const key = result.item?.key ?? result.key ?? '';
      const name = this.formatTitle(key);
      const fullPath = key.split('#')[0];
      const path = this.formatPath(key);
      const blockIndicator = this.formatBlockIndicator(key);
      const pctScore = Math.round(score * 100);
      const tier = scoreTierFor(score);

      const item = list.createDiv({
        cls: 'osc-lookup-result',
        attr: {
          role: 'listitem',
          tabindex: '0',
          'aria-label': `${name} — similarity ${pctScore}%`,
          style: `--osc-lookup-delay: ${index * 30}ms`,
        },
      });

      // Left accent bar
      item.createDiv({ cls: `osc-lookup-result-bar osc-lookup-result-bar--${tier}` });

      // Body
      const body = item.createDiv({ cls: 'osc-lookup-result-body' });

      // Header: title + score
      const header = body.createDiv({ cls: 'osc-lookup-result-header' });
      header.createSpan({
        text: name,
        cls: `osc-lookup-result-title${tier === 'high' ? ' osc-lookup-result-title--strong' : ''}`,
      });
      header.createSpan({
        text: `${pctScore}%`,
        cls: `osc-lookup-result-score osc-lookup-result-score--${tier}`,
      });

      // Path breadcrumb
      if (path) {
        body.createDiv({ text: path, cls: 'osc-lookup-result-path' });
      }

      // Block heading indicator
      if (blockIndicator) {
        body.createDiv({ text: blockIndicator, cls: 'osc-lookup-result-block-indicator' });
      }

      // Click to open
      this.registerDomEvent(item, 'click', (e) => {
        this.plugin.open_note(key, e);
      });

      // Keyboard navigation
      this.registerDomEvent(item, 'keydown', (e) => {
        if (e.key === 'Enter') {
          this.plugin.open_note(key);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (item.nextElementSibling as HTMLElement)?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (item.previousElementSibling as HTMLElement)?.focus();
        }
      });

      // Context menu
      this.registerDomEvent(item, 'contextmenu', (e) => {
        showResultContextMenu(this.app, fullPath, e);
      });

      // Hover preview
      this.registerDomEvent(item, 'mouseover', (e) => {
        this.app.workspace.trigger('hover-link', {
          event: e,
          source: LOOKUP_VIEW_TYPE,
          hoverParent: this,
          targetEl: item,
          linktext: fullPath,
        });
      });

      // Drag support
      item.setAttribute('draggable', 'true');
      this.registerDomEvent(item, 'dragstart', (e) => {
        const linkText = key.replace(/\.md$/, '').replace(/\.md#/, '#');
        e.dataTransfer?.setData('text/plain', `[[${linkText}]]`);
      });
    }
  }

  /* ─── State Displays ─── */

  showLoading(message = 'Loading...'): void {
    this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state' });
    wrapper.createDiv({ cls: 'osc-spinner' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text osc-lookup-loading-text' });
  }

  showEmpty(message = 'No results', clear = true): void {
    if (clear) this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state' });
    const iconEl = wrapper.createDiv({ cls: 'osc-lookup-empty-icon' });
    setIcon(iconEl, 'search');
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    const modKey = Platform.isMacOS || Platform.isIosApp ? 'Cmd' : 'Ctrl';
    wrapper.createEl('p', {
      text: `${modKey}+Shift+L to focus search`,
      cls: 'osc-state-hint',
    });
  }

  showError(message = 'An error occurred'): void {
    this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state osc-state--error' });
    const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
    setIcon(iconEl, 'alert-circle');
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    new ButtonComponent(wrapper)
      .setButtonText('Try again')
      .onClick(() => {
        if (this.lastQuery) {
          this.performSearch(this.lastQuery);
        }
      });
  }

  /* ─── Static Helpers ─── */

  static open(workspace: any): void {
    const existing = workspace.getLeavesOfType(LOOKUP_VIEW_TYPE);
    if (existing.length) {
      workspace.revealLeaf(existing[0]);
    } else {
      workspace.getRightLeaf(false)?.setViewState({
        type: LOOKUP_VIEW_TYPE,
        active: true,
      });
    }
  }

  static getView(workspace: any): LookupView | null {
    const leaves = workspace.getLeavesOfType(LOOKUP_VIEW_TYPE);
    return leaves.length ? leaves[0].view as LookupView : null;
  }
}
