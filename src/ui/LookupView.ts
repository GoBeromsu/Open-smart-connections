import { ItemView, WorkspaceLeaf, Workspace, debounce } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import type { ConnectionResult } from '../types/entities';
import type { LookupFilter } from './lookup-view-format';
import { getLookupEntityCount, searchCollections } from './lookup-view-search';
import {
  handleLookupModelSwitched,
  renderLookupResults,
  showLookupEmpty,
  showLookupError,
  showLookupLoading,
} from './lookup-view-render';

export const LOOKUP_VIEW_TYPE = 'open-connections-lookup';

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

  getViewType(): string { return LOOKUP_VIEW_TYPE; }
  getDisplayText(): string { return 'Smart lookup'; }
  getIcon(): string { return 'search'; }

  private setActiveFilter(filter: LookupFilter): void {
    this.activeFilter = filter;
    this.filterChipsEl?.querySelectorAll('.osc-lookup-chip').forEach((chip) => {
      (chip as HTMLElement).toggleClass('osc-lookup-chip--active', (chip as HTMLElement).dataset.filter === filter);
    });
    if (this.lastQuery) {
      void this.performSearch(this.lastQuery);
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

  onOpen(): Promise<void> {
    const contentEl = this.containerEl.children[1];
    if (!(contentEl instanceof HTMLElement)) return Promise.resolve();

    contentEl.empty();
    this.container = contentEl;
    this.container.addClass('osc-lookup-view');

    const searchWrapper = this.container.createDiv({ cls: 'osc-lookup-search-wrapper' });
    const searchIconEl = searchWrapper.createDiv({ cls: 'osc-lookup-search-icon' });
    searchIconEl.setAttribute('data-icon', 'search');
    this.searchInput = searchWrapper.createEl('input', {
      type: 'text',
      placeholder: 'Search notes semantically...',
      cls: 'osc-lookup-input',
    });

    this.clearBtn = searchWrapper.createEl('button', {
      cls: 'osc-lookup-clear-btn',
      attr: { 'aria-label': 'Clear search' },
    });
    this.clearBtn.setAttribute('data-icon', 'x');

    this.filterChipsEl = this.container.createDiv({ cls: 'osc-lookup-filters' });
    for (const filter of [
      { key: 'all' as const, label: 'All' },
      { key: 'notes' as const, label: 'Notes' },
      { key: 'blocks' as const, label: 'Blocks' },
    ]) {
      const chip = this.filterChipsEl.createEl('button', {
        text: filter.label,
        cls: `osc-lookup-chip${filter.key === 'all' ? ' osc-lookup-chip--active' : ''}`,
        attr: { 'data-filter': filter.key },
      });
      this.registerDomEvent(chip, 'click', () => this.setActiveFilter(filter.key));
    }

    this.searchMetaEl = this.container.createDiv({ cls: 'osc-lookup-meta' });
    this.resultsContainer = this.container.createDiv({ cls: 'osc-lookup-results' });

    const debouncedSearch = debounce((query: string) => this.performSearch(query), 500, true);
    this.registerDomEvent(this.searchInput, 'input', () => {
      this.updateClearButton();
      debouncedSearch(this.searchInput.value);
    });
    this.registerDomEvent(this.searchInput, 'keydown', (event) => {
      const keyEvent = event;
      if (keyEvent.key === 'Enter') {
        void this.performSearch(this.searchInput.value);
      } else if (keyEvent.key === 'Escape') {
        this.clearSearch();
      }
    });
    this.registerDomEvent(this.clearBtn, 'click', () => {
      this.clearSearch();
      this.searchInput.focus();
    });
    this.registerEvent(this.app.workspace.on('open-connections:model-switched', () => this.handleModelSwitched()));

    this.showEmpty('Type a query to search your notes semantically');
    this.searchInput.focus();
    return Promise.resolve();
  }

  onClose(): Promise<void> { this.container?.empty(); return Promise.resolve(); }

  async performSearch(query: string): Promise<void> {
    if (!query.trim()) {
      this.clearSearch();
      return;
    }

    this.lastQuery = query;
    if (!this.plugin.embed_ready || !this.plugin.embed_adapter) {
      this.showLoading('Embedding model is still loading...');
      return;
    }

    this.showLoading(`Searching across ${getLookupEntityCount(this.plugin, this.activeFilter)} items...`);
    const startTime = performance.now();

    try {
      const searchAdapter = this.plugin.search_embed_model;
      if (!searchAdapter) {
        this.showError('No embedding adapter available.');
        return;
      }
      const embedResults = typeof searchAdapter.embed_query === 'function'
        ? await searchAdapter.embed_query(query)
        : await searchAdapter.embed_batch([{ _embed_input: query }]);
      const queryVec = embedResults?.[0]?.vec;
      if (!queryVec || queryVec.length === 0) {
        this.showError('Failed to embed search query.');
        return;
      }

      const results = await searchCollections(this.plugin, this.activeFilter, queryVec, 20);
      this.renderResults(query, results, Math.round(performance.now() - startTime));
    } catch (error) {
      this.showError(`Search failed: ${(error as Error).message}`);
    }
  }

  private handleModelSwitched(): void { handleLookupModelSwitched(this.createRenderContext()); }

  renderResults(query: string, results: ConnectionResult[], elapsedMs?: number): void { renderLookupResults(this.createRenderContext(), query, results, elapsedMs); }

  showLoading(message = 'Loading...'): void { showLookupLoading(this.createRenderContext(), message); }

  showEmpty(message = 'No results', clear = true): void { showLookupEmpty(this.createRenderContext(), message, clear); }

  showError(message = 'An error occurred'): void { showLookupError(this.createRenderContext(), message); }

  static open(workspace: Workspace): void {
    const existingLeaf = workspace.getLeavesOfType(LOOKUP_VIEW_TYPE)[0];
    if (existingLeaf) {
      void workspace.revealLeaf(existingLeaf);
    } else {
      void workspace.getRightLeaf(false)?.setViewState({ type: LOOKUP_VIEW_TYPE, active: true });
    }
  }

  private createRenderContext() {
    return {
      app: this.app,
      plugin: this.plugin,
      resultsContainer: this.resultsContainer,
      searchMetaEl: this.searchMetaEl,
      lastQuery: this.lastQuery,
      registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => {
        this.registerDomEvent(el, type as never, callback as never);
      },
      retrySearch: () => { void this.performSearch(this.lastQuery); },
    };
  }
}
