import { ItemView, WorkspaceLeaf, debounce } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { lookup } from '../../core/search/lookup';

export const LOOKUP_VIEW_TYPE = 'smart-connections-lookup';

export class LookupView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  searchInput: HTMLInputElement;
  resultsContainer: HTMLElement;

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

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.container = this.containerEl.children[1] as HTMLElement;
    this.container.addClass('osc-lookup-view');

    // Search header
    const searchContainer = this.container.createDiv({ cls: 'osc-lookup-search' });
    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search notes semantically...',
      cls: 'osc-lookup-input',
    });

    // Debounced search
    const debouncedSearch = debounce(
      (query: string) => this.performSearch(query),
      500,
      true,
    );

    this.searchInput.addEventListener('input', () => {
      debouncedSearch(this.searchInput.value);
    });

    // Also search on Enter
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.performSearch(this.searchInput.value);
      }
    });

    // Results area
    this.resultsContainer = this.container.createDiv({ cls: 'osc-lookup-results' });

    // Initial state
    this.showEmpty('Type a query to search your notes semantically');

    // Focus the input
    this.searchInput.focus();
  }

  async onClose(): Promise<void> {
    this.container?.empty();
  }

  async performSearch(query: string): Promise<void> {
    if (!query || query.trim().length === 0) {
      this.showEmpty('Type a query to search your notes semantically');
      return;
    }

    if (!this.plugin.embed_ready || !this.plugin.embed_model) {
      this.showLoading('Embedding model is still loading...');
      return;
    }

    // Show searching state
    this.showLoading('Searching...');

    try {
      // Get all entities with embeddings
      const entities: any[] = [];
      if (this.plugin.source_collection) {
        for (const source of this.plugin.source_collection.all) {
          if (source.vec) entities.push(source);
        }
      }
      if (this.plugin.block_collection) {
        for (const block of this.plugin.block_collection.all) {
          if (block.vec) entities.push(block);
        }
      }

      if (entities.length === 0) {
        this.showEmpty('No embedded notes found. Wait for embedding to complete.');
        return;
      }

      const results = await lookup(
        query,
        this.plugin.embed_model.adapter,
        entities,
        { limit: 20 },
      );

      this.renderResults(query, results);
    } catch (e) {
      this.showError('Search failed: ' + (e as Error).message);
    }
  }

  renderResults(query: string, results: any[]): void {
    this.resultsContainer.empty();

    if (!results || results.length === 0) {
      this.showEmpty('No results found for "' + query + '"', false);
      return;
    }

    const list = this.resultsContainer.createDiv({ cls: 'osc-results' });

    for (const result of results) {
      const score = result.score ?? result.sim ?? 0;
      const key = result.item?.key ?? result.key ?? '';
      const name = key.split('/').pop()?.replace(/\.md$/, '')?.replace(/#/g, ' > ') ?? 'Unknown';
      const fullPath = key.split('#')[0];

      const item = list.createDiv({ cls: 'osc-result-item' });

      // Score badge
      const scoreBadge = item.createSpan({ cls: 'osc-score' });
      const scoreVal = Math.round(score * 100) / 100;
      scoreBadge.setText(scoreVal.toFixed(2));
      if (score >= 0.85) scoreBadge.addClass('osc-score--high');
      else if (score >= 0.7) scoreBadge.addClass('osc-score--medium');
      else scoreBadge.addClass('osc-score--low');

      // Title (show block reference if present)
      item.createSpan({ text: name, cls: 'osc-result-title' });

      // Click to open
      item.addEventListener('click', (e) => {
        this.plugin.open_note(key, e);
      });

      // Hover preview
      item.addEventListener('mouseover', (e) => {
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
      item.addEventListener('dragstart', (e) => {
        const linkText = key.replace(/\.md$/, '').replace(/\.md#/, '#');
        e.dataTransfer?.setData('text/plain', `[[${linkText}]]`);
      });
    }
  }

  showLoading(message = 'Loading...'): void {
    this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state' });
    wrapper.createDiv({ cls: 'osc-spinner' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  }

  showEmpty(message = 'No results', clear = true): void {
    if (clear) this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  }

  showError(message = 'An error occurred'): void {
    this.resultsContainer.empty();
    const wrapper = this.resultsContainer.createDiv({ cls: 'osc-state osc-state--error' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  }

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
