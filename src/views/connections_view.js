import { ItemView } from 'obsidian';

export const CONNECTIONS_VIEW_TYPE = 'smart-connections-view';

export class ConnectionsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType() { return CONNECTIONS_VIEW_TYPE; }
  getDisplayText() { return 'Connections'; }
  getIcon() { return 'network'; }

  async onOpen() {
    this.containerEl.children[1].empty();
    this.container = this.containerEl.children[1];
    this.container.addClass('osc-connections-view');

    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) this.renderView(file.path);
      })
    );

    const active = this.app.workspace.getActiveFile();
    if (active) this.renderView(active.path);
  }

  async onClose() {
    this.container?.empty();
  }

  async renderView(targetPath) {
    if (!this.container) return;
    if (typeof this.container.checkVisibility === 'function' && !this.container.checkVisibility()) return;
    if (!targetPath) {
      targetPath = this.app.workspace.getActiveFile()?.path;
    }
    if (!targetPath) {
      this.showEmpty('No active file');
      return;
    }

    const env = this.plugin.env;
    if (!env?.smart_sources) {
      this.showLoading('Waiting for Smart Environment...');
      return;
    }

    let entity = env.smart_sources.get(targetPath);

    if (!entity) {
      entity = env.smart_sources.init_file_path?.(targetPath);
      if (entity) {
        env.queue_source_re_import?.(entity);
        this.showLoading('Embedding current note...');
        try {
          await env.run_re_import?.();
          entity = env.smart_sources.get(targetPath);
        } catch (e) {
          this.showError('Embedding failed: ' + e.message);
          return;
        }
      } else {
        this.showEmpty('Source not found. Check exclusion settings.');
        return;
      }
    }

    if (!entity?.vec) {
      this.showLoading('Embedding current note...');
      try {
        entity.queue_import?.();
        await entity.collection?.process_source_import_queue?.();
        if (!entity.vec) {
          this.showEmpty('No embedding available. The note may be too short or excluded.');
          return;
        }
      } catch (e) {
        this.showError('Embedding failed: ' + e.message);
        return;
      }
    }

    try {
      const results = await entity.find_connections({
        ...(this.plugin.settings?.smart_view_filter || {}),
      });
      this.renderResults(targetPath, results);
    } catch (e) {
      this.showError('Failed to find connections: ' + e.message);
    }
  }

  renderResults(targetPath, results) {
    this.container.empty();
    const fileName = targetPath.split('/').pop().replace(/\.md$/, '');

    // Header
    const header = this.container.createDiv({ cls: 'osc-header' });
    header.createSpan({ text: fileName, cls: 'osc-header-title' });

    const actions = header.createDiv({ cls: 'osc-header-actions' });
    const refreshBtn = actions.createEl('button', { cls: 'osc-icon-btn', attr: { 'aria-label': 'Refresh' } });
    refreshBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
    refreshBtn.addEventListener('click', () => this.renderView(targetPath));

    // Embedding progress
    this.renderEmbeddingProgress();

    // Results
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
      item.addEventListener('click', (e) => {
        this.plugin.open_note(fullPath, e);
      });

      // Hover preview
      item.addEventListener('mouseover', (e) => {
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
      item.addEventListener('dragstart', (e) => {
        const linkText = fullPath.replace(/\.md$/, '');
        e.dataTransfer.setData('text/plain', `[[${linkText}]]`);
      });
    }
  }

  renderEmbeddingProgress() {
    const env = this.plugin.env;
    if (!env?.smart_sources) return;

    const sources = env.smart_sources;
    const total = sources.keys?.length ?? 0;
    const embedded = sources.embedded_items?.length ?? sources.keys?.filter(k => sources.get(k)?.vec)?.length ?? 0;

    if (total > 0 && embedded < total) {
      const progress = this.container.createDiv({ cls: 'osc-embed-progress' });
      const label = progress.createDiv({ cls: 'osc-embed-progress-label' });
      label.createSpan({ text: 'Embedding vault' });
      label.createSpan({ text: `${embedded} / ${total}`, cls: 'osc-embed-progress-count' });

      const track = progress.createDiv({ cls: 'osc-progress-track' });
      const fill = track.createDiv({ cls: 'osc-progress-fill' });
      fill.style.width = `${Math.round((embedded / total) * 100)}%`;
    }
  }

  showLoading(message = 'Loading...') {
    this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.createDiv({ cls: 'osc-spinner' });
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  }

  showEmpty(message = 'No similar notes found', clear = true) {
    if (clear) this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    wrapper.createEl('p', { text: 'Try writing more content or adjusting minimum character settings.', cls: 'osc-state-hint' });
  }

  showError(message = 'An error occurred') {
    this.container.empty();
    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
    const retryBtn = wrapper.createEl('button', { text: 'Retry', cls: 'osc-btn osc-btn--primary' });
    retryBtn.addEventListener('click', () => this.renderView());
  }

  static open(workspace) {
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

  static get_view(workspace) {
    const leaves = workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
    return leaves.length ? leaves[0].view : null;
  }
}
