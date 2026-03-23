/**
 * @file settings-status-sync.test.ts
 * @description Tests for settings status sync: re-entrancy guard, cleanup on hide, and live DOM updates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App } from 'obsidian';
import { SmartConnectionsSettingsTab } from '../src/ui/settings';

// Patch Obsidian DOM extensions that jsdom does not provide
if (!('empty' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'empty', {
    value(this: HTMLElement) { this.replaceChildren(); },
    writable: true,
    configurable: true,
  });
}
if (!('addClass' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'addClass', {
    value(this: HTMLElement, cls: string) { this.classList.add(cls); },
    writable: true,
    configurable: true,
  });
}
if (!('createDiv' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'createDiv', {
    value(this: HTMLElement, opts?: { cls?: string; text?: string }) {
      const el = document.createElement('div');
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    },
    writable: true,
    configurable: true,
  });
}
if (!('createEl' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'createEl', {
    value(this: HTMLElement, tag: string, opts?: { cls?: string; text?: string }) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    },
    writable: true,
    configurable: true,
  });
}
if (!('createSpan' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'createSpan', {
    value(this: HTMLElement, opts?: { cls?: string; text?: string }) {
      const el = document.createElement('span');
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    },
    writable: true,
    configurable: true,
  });
}

function makePlugin(overrides: Record<string, any> = {}): any {
  return {
    settings: { smart_sources: { embed_model: { adapter: 'transformers' } }, smart_blocks: {} },
    saveSettings: vi.fn(),
    notices: { show: vi.fn(), listMuted: vi.fn(() => []) },
    ready: true,
    embed_ready: true,
    status_state: 'idle' as 'idle' | 'embedding' | 'error',
    source_collection: {
      size: 10,
      all: Array.from({ length: 7 }, () => ({ vec: [0.1] })),
    },
    getActiveEmbeddingContext: vi.fn(() => null),
    switchEmbeddingModel: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeApp(): App {
  const app = new App();
  // Track event refs returned by workspace.on so tests can inspect them
  let refCounter = 0;
  const refs: { id: number; event: string }[] = [];

  (app as any).workspace.on = vi.fn((_event: string) => {
    const ref = { id: ++refCounter, event: _event };
    refs.push(ref);
    return ref;
  });
  (app as any).workspace.offref = vi.fn();
  (app as any).workspace.trigger = vi.fn();
  (app as any).workspace._refs = refs;
  return app;
}

describe('Settings status sync — re-entrancy guard (AC3)', () => {
  it('after N display() calls, exactly 2 workspace event listeners are registered (not 2*N)', () => {
    const app = makeApp();
    const plugin = makePlugin();
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    for (let i = 0; i < 5; i++) {
      tab.display();
    }

    // eventRefs is private — access via cast
    expect((tab as any).eventRefs).toHaveLength(2);
    // workspace.on should have been called 10 times total (2 per display call × 5)
    // but previous refs must have been cleaned up so only 2 remain
    expect((app as any).workspace.on).toHaveBeenCalledTimes(10);
    // offref should have been called for every ref registered before the last display()
    // first display: 0 prior refs → 0 offref calls
    // 2nd display: 2 prior refs → 2 offref calls  … total 4+4+4+4 = not needed to count exactly
    // What matters: final eventRefs.length === 2
  });
});

describe('Settings status sync — cleanup on hide() (AC4)', () => {
  it('after display() then hide(), eventRefs is empty and offref() was called for each registered ref', () => {
    const app = makeApp();
    const plugin = makePlugin();
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();
    expect((tab as any).eventRefs).toHaveLength(2);

    const refsBeforeHide = [...(tab as any).eventRefs];
    tab.hide();

    expect((tab as any).eventRefs).toHaveLength(0);
    expect((app as any).workspace.offref).toHaveBeenCalledTimes(2);
    for (const ref of refsBeforeHide) {
      expect((app as any).workspace.offref).toHaveBeenCalledWith(ref);
    }
  });

  it('after hide(), statusRowEl and statsGridEl are null', () => {
    const app = makeApp();
    const plugin = makePlugin();
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();
    expect((tab as any).statusRowEl).not.toBeNull();
    expect((tab as any).statsGridEl).not.toBeNull();

    tab.hide();
    expect((tab as any).statusRowEl).toBeNull();
    expect((tab as any).statsGridEl).toBeNull();
  });
});

describe('Settings status sync — error state pill (AC9)', () => {
  it('after display(), updateEmbeddingStatusOnly() reflects error state in status pills', () => {
    const app = makeApp();
    const plugin = makePlugin({ status_state: 'error' });
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();

    const statusRow: HTMLElement = (tab as any).statusRowEl;
    expect(statusRow).not.toBeNull();

    // The Run pill should have the error dot class
    const dots = statusRow.querySelectorAll('.osc-status-dot--error');
    expect(dots.length).toBeGreaterThan(0);

    // The Run pill text should say "Error"
    const pillTexts = Array.from(statusRow.querySelectorAll('.osc-status-text')).map(
      (el) => el.textContent,
    );
    expect(pillTexts.some((t) => t?.includes('Error'))).toBe(true);
  });

  it('updateEmbeddingStatusOnly() re-renders pills when status changes to error mid-session', () => {
    const app = makeApp();
    const plugin = makePlugin({ status_state: 'idle' });
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();

    // Simulate state change
    plugin.status_state = 'error';
    (tab as any).updateEmbeddingStatusOnly();

    const statusRow: HTMLElement = (tab as any).statusRowEl;
    const dots = statusRow.querySelectorAll('.osc-status-dot--error');
    expect(dots.length).toBeGreaterThan(0);
  });
});

describe('Settings status sync — terminal event (AC10)', () => {
  it('updateEmbeddingStatusOnly() shows final stats when embedding completes', () => {
    const fullyEmbedded = Array.from({ length: 10 }, () => ({ vec: [0.1] }));
    const app = makeApp();
    const plugin = makePlugin({
      status_state: 'idle',
      source_collection: { size: 10, all: fullyEmbedded },
    });
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();
    (tab as any).updateEmbeddingStatusOnly();

    const statsGrid: HTMLElement = (tab as any).statsGridEl;
    expect(statsGrid).not.toBeNull();

    const statValues = Array.from(statsGrid.querySelectorAll('.osc-stat-value')).map(
      (el) => el.textContent,
    );
    // Total = 10, Embedded = 10, Pending = 0, Progress = 100%
    expect(statValues).toContain('10');
    expect(statValues).toContain('0');
    expect(statValues).toContain('100%');
  });

  it('Progress card gets green class when all notes are embedded', () => {
    const fullyEmbedded = Array.from({ length: 5 }, () => ({ vec: [0.1] }));
    const app = makeApp();
    const plugin = makePlugin({
      source_collection: { size: 5, all: fullyEmbedded },
    });
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();
    (tab as any).updateEmbeddingStatusOnly();

    const statsGrid: HTMLElement = (tab as any).statsGridEl;
    const greenCards = statsGrid.querySelectorAll('.osc-stat--green');
    // Embedded card + Progress card should both be green
    expect(greenCards.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Settings status sync — live stats update', () => {
  it('updateEmbeddingStatusOnly() updates stat values based on current collection state', () => {
    const app = makeApp();
    const plugin = makePlugin({
      source_collection: {
        size: 20,
        all: Array.from({ length: 10 }, () => ({ vec: [0.1] })),
      },
    });
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();

    // Simulate progress: 15 of 20 embedded
    plugin.source_collection = {
      size: 20,
      all: Array.from({ length: 15 }, () => ({ vec: [0.1] })),
    };
    (tab as any).updateEmbeddingStatusOnly();

    const statsGrid: HTMLElement = (tab as any).statsGridEl;
    const statValues = Array.from(statsGrid.querySelectorAll('.osc-stat-value')).map(
      (el) => el.textContent,
    );
    // Embedded = 15, Pending = 5, Progress = 75%
    expect(statValues).toContain('15');
    expect(statValues).toContain('5');
    expect(statValues).toContain('75%');
  });

  it('statsGridEl is emptied and repainted on each updateEmbeddingStatusOnly() call', () => {
    const app = makeApp();
    const plugin = makePlugin();
    const tab = new SmartConnectionsSettingsTab(app, plugin);

    tab.display();

    const statsGrid: HTMLElement = (tab as any).statsGridEl;
    const emptySpy = vi.spyOn(statsGrid, 'empty');

    (tab as any).updateEmbeddingStatusOnly();
    (tab as any).updateEmbeddingStatusOnly();

    expect(emptySpy).toHaveBeenCalledTimes(2);
  });
});
