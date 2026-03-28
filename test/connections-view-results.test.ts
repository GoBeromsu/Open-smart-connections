import { describe, expect, it, vi } from 'vitest';

import { ConnectionsView } from '../src/ui/ConnectionsView';

function createPluginStub() {
  return {
    ready: true,
    embed_ready: true,
    status_state: 'idle',
    settings: {
      smart_sources: { embed_model: { adapter: 'openai' } },
      smart_notices: { muted: {} },
    },
    block_collection: {
      nearest: vi.fn(async () => []),
    },
    runEmbeddingJob: vi.fn(async () => ({})),
    reembedStaleEntities: vi.fn(async () => 0),
    saveSettings: vi.fn(async () => {}),
    app: {
      workspace: {
        trigger: vi.fn(),
        getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => {}) })),
        getMostRecentLeaf: vi.fn(() => ({ openFile: vi.fn(async () => {}) })),
        revealLeaf: vi.fn(),
        getLeavesOfType: vi.fn(() => []),
      },
      vault: {
        getAbstractFileByPath: vi.fn(() => ({ path: 'target.md' })),
      },
    },
    open_note: vi.fn(),
  } as any;
}

function createObsidianLikeContainer(): any {
  const addHelpers = (el: HTMLElement & Record<string, any>) => {
    el.empty = function empty() {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
    el.addClass = function addClass(cls: string) {
      this.classList.add(cls);
    };
    el.removeClass = function removeClass(cls: string) {
      this.classList.remove(cls);
    };
    el.toggleClass = function toggleClass(cls: string, force: boolean) {
      this.classList.toggle(cls, force);
    };
    el.setText = function setText(text: string) {
      this.textContent = text;
    };
    el.createDiv = function createDiv(opts: Record<string, any> = {}) {
      const div = document.createElement('div') as HTMLElement & Record<string, any>;
      if (opts.cls) div.className = opts.cls;
      if (opts.text) div.textContent = opts.text;
      if (opts.attr) {
        for (const [key, value] of Object.entries(opts.attr)) div.setAttribute(key, String(value));
      }
      this.appendChild(div);
      addHelpers(div);
      return div;
    };
    el.createSpan = function createSpan(opts: Record<string, any> = {}) {
      return this.createEl('span', opts);
    };
    el.createEl = function createEl(tag: string, opts: Record<string, any> = {}) {
      const child = document.createElement(tag) as HTMLElement & Record<string, any>;
      if (opts.cls) child.className = opts.cls;
      if (opts.text) child.textContent = opts.text;
      if (opts.attr) {
        for (const [key, value] of Object.entries(opts.attr)) child.setAttribute(key, String(value));
      }
      this.appendChild(child);
      addHelpers(child);
      return child;
    };
  };

  const root = document.createElement('div') as HTMLElement & Record<string, any>;
  addHelpers(root);
  return root;
}

describe('ConnectionsView render cache', () => {
  it('re-renders when folderFilter changes even if raw results are unchanged', () => {
    const plugin = createPluginStub();
    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();
    (view as any).registerDomEvent = vi.fn();

    const results = [
      { item: { key: 'FolderA/alpha.md#One', source_key: 'FolderA/alpha.md' }, score: 0.9 },
      { item: { key: 'FolderB/beta.md#Two', source_key: 'FolderB/beta.md' }, score: 0.8 },
    ];

    view.renderResults('note.md', results as any);
    const before = (view as any).container.querySelectorAll('.osc-result-item').length;
    expect(before).toBe(2);

    (view as any).folderFilter = 'FolderA';
    view.renderResults('note.md', results as any);
    const after = (view as any).container.querySelectorAll('.osc-result-item').length;

    expect(after).toBe(1);
    expect((view as any).container.textContent).toContain('alpha');
    expect((view as any).container.textContent).not.toContain('beta');
  });
});
