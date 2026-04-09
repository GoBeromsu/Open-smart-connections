import { App, Setting } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSourceSettings } from '../src/ui/settings-basic-sections';

function createPlugin() {
  return {
    settings: {
      smart_sources: {
        min_chars: 200,
        file_exclusions: 'Untitled',
        folder_exclusions: '',
        excluded_headings: '',
      },
    },
    saveSettings: vi.fn(async () => {}),
    notices: { show: vi.fn() },
    getEmbedRuntimeState: vi.fn(() => ({ backfill: { kind: 'idle' } })),
    enqueueEmbeddingJob: vi.fn(async (job: { run: () => Promise<void> }) => {
      await job.run();
    }),
    source_collection: {
      all: [],
      data_adapter: { save: vi.fn(async () => {}) },
      recomputeEmbeddedCount: vi.fn(),
    },
    block_collection: {
      data_adapter: { save: vi.fn(async () => {}) },
      recomputeEmbeddedCount: vi.fn(),
    },
    removeSource: vi.fn(),
    processNewSourcesChunked: vi.fn(async () => {}),
    refreshStatus: vi.fn(),
    logger: { info: vi.fn() },
    app: {
      workspace: { trigger: vi.fn() },
    },
  } as any;
}

function createConfig(plugin: any) {
  return {
    getConfig: (path: string, fallback: unknown) => {
      const keys = path.split('.');
      let value: any = plugin.settings;
      for (const key of keys) value = value?.[key];
      return value ?? fallback;
    },
    setConfig: vi.fn((path: string, value: unknown) => {
      const keys = path.split('.');
      let target = plugin.settings as any;
      for (let i = 0; i < keys.length - 1; i++) {
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = value;
    }),
  };
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
    el.createDiv = function createDiv(opts: Record<string, any> = {}) {
      const div = document.createElement('div') as HTMLElement & Record<string, any>;
      if (opts.cls) div.className = opts.cls;
      if (opts.text) div.textContent = opts.text;
      this.appendChild(div);
      addHelpers(div);
      return div;
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

describe('renderSourceSettings', () => {
  beforeEach(() => {
    Setting.reset();
  });

  it('replaces folder exclusion text input with excluded folders UI', () => {
    const app = new App();
    (app.vault as any).getAllLoadedFiles = () => [];
    const plugin = createPlugin();
    const config = createConfig(plugin);
    const container = createObsidianLikeContainer();

    renderSourceSettings(container, app, plugin, config as any, vi.fn());

    const settingNames = Setting.instances.map((setting) => setting.name);
    expect(settingNames).toContain('Excluded folders');
    expect(settingNames).not.toContain('Folder exclusions');
  });
});
