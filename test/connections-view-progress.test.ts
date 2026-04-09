import { describe, expect, it, vi } from 'vitest';

import { updateConnectionsProgressBanner } from '../src/ui/connections-view-progress';

function createPluginStub(overrides: Record<string, unknown> = {}) {
  return {
    embed_ready: true,
    status_state: 'idle',
    block_collection: {
      effectiveTotal: 100,
      embeddedCount: 100,
    },
    ...overrides,
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
      this.appendChild(child);
      addHelpers(child);
      return child;
    };
  };

  const root = document.createElement('div') as HTMLElement & Record<string, any>;
  addHelpers(root);
  return root;
}

function createView(plugin: any) {
  return {
    plugin,
    container: createObsidianLikeContainer(),
    embedProgress: null,
    _pendingRetry: null,
    lastRenderedPath: null,
    lastRenderFingerprint: null,
    _lastResultKeys: [],
    autoEmbedRequestedForPath: null,
  } as any;
}

describe('updateConnectionsProgressBanner', () => {
  it('shows a qualitative settings-SSOT banner during embedding without rendering quantitative progress', () => {
    const plugin = createPluginStub({
      status_state: 'embedding',
      block_collection: {
        effectiveTotal: 100,
        embeddedCount: 12,
      },
    });
    const view = createView(plugin);

    updateConnectionsProgressBanner(view);

    expect(view.container.querySelector('.osc-banner')?.textContent).toContain('Detailed progress is in Settings');
    expect(view.container.querySelector('.osc-embed-progress')).toBeNull();
  });

  it('shows an error-oriented qualitative banner when embedding fails mid-run', () => {
    const plugin = createPluginStub({
      status_state: 'error',
      embed_ready: false,
      block_collection: {
        effectiveTotal: 100,
        embeddedCount: 40,
      },
    });
    const view = createView(plugin);

    updateConnectionsProgressBanner(view);

    expect(view.container.textContent).toContain('Detailed diagnostics are in Settings');
    expect(view.container.querySelector('.osc-embed-progress')).toBeNull();
  });

  it('clears the banner when there is no active or pending indexing work', () => {
    const plugin = createPluginStub({
      status_state: 'embedding',
      block_collection: {
        effectiveTotal: 100,
        embeddedCount: 20,
      },
    });
    const view = createView(plugin);

    updateConnectionsProgressBanner(view);
    expect(view.container.querySelector('.osc-banner')).not.toBeNull();

    view.plugin.status_state = 'idle';
    view.plugin.block_collection.embeddedCount = 100;
    updateConnectionsProgressBanner(view);

    expect(view.container.querySelector('.osc-banner')).toBeNull();
  });
});
