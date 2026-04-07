import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Setting } from 'obsidian';

import { renderEmbeddingModelSection } from '../src/ui/settings-embedding-model-section';
import '../src/ui/embed-adapters/gemini';
import '../src/ui/embed-adapters/openai';
import '../src/ui/embed-adapters/upstage';

function patchObsidianHelpers(el: HTMLElement): HTMLElement {
  const node = el as HTMLElement & {
    createEl?: (tag: string, opts?: { text?: string; cls?: string }) => HTMLElement;
    createDiv?: (opts?: { text?: string; cls?: string }) => HTMLDivElement;
    createSpan?: (opts?: { text?: string; cls?: string }) => HTMLSpanElement;
    empty?: () => void;
    addClass?: (...cls: string[]) => void;
    removeClass?: (...cls: string[]) => void;
    setText?: (text: string) => void;
    setAttr?: (name: string, value: string) => void;
  };

  node.empty ??= function empty(): void { while (this.firstChild) this.removeChild(this.firstChild); };
  node.addClass ??= function addClass(...cls: string[]): void { this.classList.add(...cls); };
  node.removeClass ??= function removeClass(...cls: string[]): void { this.classList.remove(...cls); };
  node.createEl ??= function createEl(tag: string, opts?: { text?: string; cls?: string }): HTMLElement {
    const child = document.createElement(tag);
    if (opts?.text) child.textContent = opts.text;
    if (opts?.cls) child.className = opts.cls;
    patchObsidianHelpers(child);
    this.appendChild(child);
    return child;
  };
  node.createDiv ??= function createDiv(opts?: { text?: string; cls?: string }): HTMLDivElement {
    return this.createEl!('div', opts) as HTMLDivElement;
  };
  node.createSpan ??= function createSpan(opts?: { text?: string; cls?: string }): HTMLSpanElement {
    return this.createEl!('span', opts) as HTMLSpanElement;
  };
  node.setText ??= function setText(text: string): void { this.textContent = text; };
  node.setAttr ??= function setAttr(name: string, value: string): void { this.setAttribute(name, value); };

  return el;
}

patchObsidianHelpers(HTMLElement.prototype as unknown as HTMLElement);

function getPath(target: Record<string, any>, path: string, fallback: unknown): unknown {
  const result = path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, target);

  return result === undefined ? fallback : result;
}

function setPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;

  let cursor = target;
  for (const segment of parts) {
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  if (value === undefined) {
    delete cursor[last];
    return;
  }

  cursor[last] = value;
}

describe('renderEmbeddingModelSection', () => {
  let containerEl: HTMLDivElement;
  let configState: Record<string, any>;
  let config: { getConfig<T>(path: string, fallback: T): T; setConfig(path: string, value: unknown): void };
  let plugin: { switchEmbeddingModel: ReturnType<typeof vi.fn> };
  let confirmReembed: ReturnType<typeof vi.fn>;
  let triggerReEmbed: ReturnType<typeof vi.fn>;
  let display: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (Setting as any).reset?.();
    containerEl = patchObsidianHelpers(document.createElement('div')) as HTMLDivElement;
    configState = {
      smart_sources: {
        embed_model: {
          adapter: 'transformers',
          transformers: { model_key: 'TaylorAI/bge-micro-v2' },
          openai: { model_key: 'text-embedding-3-small' },
          gemini: { model_key: 'gemini-embedding-001' },
          upstage: {},
        },
      },
    };
    config = {
      getConfig: <T,>(path: string, fallback: T): T => getPath(configState, path, fallback) as T,
      setConfig: (path: string, value: unknown): void => setPath(configState, path, value),
    };
    plugin = {
      switchEmbeddingModel: vi.fn(async () => {}),
    };
    confirmReembed = vi.fn(async () => true);
    triggerReEmbed = vi.fn(async () => {});
    display = vi.fn();
  });

  it('auto-populates the Upstage indexing and search model pair when switching providers', async () => {
    renderEmbeddingModelSection(
      containerEl,
      plugin as any,
      config,
      confirmReembed,
      triggerReEmbed,
      display,
    );

    const providerSetting = (Setting as any).instances.find((item: any) => item.name === 'Provider');
    await providerSetting.dropdown.trigger('upstage');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(configState.smart_sources.embed_model.adapter).toBe('upstage');
    expect(configState.smart_sources.embed_model.upstage.model_key).toBe('embedding-passage');
    expect(configState.smart_sources.search_model).toEqual({
      adapter: 'upstage',
      model_key: 'embedding-query',
    });
    expect(triggerReEmbed).toHaveBeenCalledTimes(1);
  });

  it('clears the stale Upstage search model when switching to a different provider', async () => {
    configState.smart_sources.embed_model.adapter = 'upstage';
    configState.smart_sources.embed_model.upstage = { model_key: 'embedding-passage' };
    configState.smart_sources.search_model = {
      adapter: 'upstage',
      model_key: 'embedding-query',
    };

    renderEmbeddingModelSection(
      containerEl,
      plugin as any,
      config,
      confirmReembed,
      triggerReEmbed,
      display,
    );

    const providerSetting = (Setting as any).instances.find((item: any) => item.name === 'Provider');
    await providerSetting.dropdown.trigger('openai');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(configState.smart_sources.embed_model.adapter).toBe('openai');
    expect(configState.smart_sources.search_model).toBeUndefined();
    expect(triggerReEmbed).toHaveBeenCalledTimes(1);
  });
});
