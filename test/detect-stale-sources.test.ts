/**
 * @file detect-stale-sources.test.ts
 * @description Tests for detectStaleSourcesOnStartup (collection-loader.ts)
 *
 * Covers:
 *   - returns 0 when source_collection is absent
 *   - returns 0 when all sources have no stored mtime
 *   - returns 0 when all mtimes match the file on disk
 *   - returns 0 when the vault file does not exist for a source
 *   - marks a source as stale and adds it to pendingReImportPaths when mtime changed
 *   - counts multiple stale sources correctly
 *   - does not add non-stale sources to pendingReImportPaths
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectStaleSourcesOnStartup } from '../src/ui/collection-loader';

// ── TFile shim ───────────────────────────────────────────────────────────────
// The real function does `file instanceof TFile`, so we need a class to satisfy
// that check inside the jsdom environment.  The obsidian mock in test/mocks/
// exports a TFile stub; importing it here gives us the same reference the
// production code uses.
import { TFile } from 'obsidian';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(key: string, storedMtime: number | undefined): any {
  return {
    key,
    data: {
      last_read: storedMtime != null ? { mtime: storedMtime } : undefined,
    },
  };
}

function makeTFile(path: string, mtime: number): any {
  const f = Object.create(TFile.prototype);
  f.path = path;
  f.stat = { mtime };
  return f;
}

function makePlugin(
  sources: any[],
  vaultFiles: Record<string, any>,  // path -> TFile-like or null
): any {
  return {
    source_collection: {
      all: sources,
    },
    pendingReImportPaths: new Set<string>(),
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => vaultFiles[path] ?? null,
      },
    },
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectStaleSourcesOnStartup', () => {
  it('returns 0 when source_collection is absent', async () => {
    const plugin = makePlugin([], {});
    plugin.source_collection = undefined;

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
  });

  it('returns 0 when source_collection is empty', async () => {
    const plugin = makePlugin([], {});

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
  });

  it('returns 0 and adds nothing when source has no stored mtime', async () => {
    const source = makeSource('note.md', undefined);
    const plugin = makePlugin([source], {});

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
    expect(plugin.pendingReImportPaths.size).toBe(0);
  });

  it('returns 0 when vault file does not exist for a source with stored mtime', async () => {
    const source = makeSource('missing.md', 1000);
    const plugin = makePlugin([source], {}); // getAbstractFileByPath returns null

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
    expect(plugin.pendingReImportPaths.size).toBe(0);
  });

  it('returns 0 when vault returns a non-TFile entry for the path', async () => {
    const source = makeSource('folder/note.md', 1000);
    // Plain object — not an instance of TFile
    const plugin = makePlugin([source], { 'folder/note.md': { path: 'folder/note.md' } });

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
    expect(plugin.pendingReImportPaths.size).toBe(0);
  });

  it('returns 0 and does not add to pendingReImportPaths when mtime matches', async () => {
    const source = makeSource('note.md', 5000);
    const file = makeTFile('note.md', 5000);
    const plugin = makePlugin([source], { 'note.md': file });

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(0);
    expect(plugin.pendingReImportPaths.size).toBe(0);
  });

  it('returns 1 and adds path to pendingReImportPaths when mtime has changed', async () => {
    const source = makeSource('note.md', 1000);
    const file = makeTFile('note.md', 9999); // newer on disk
    const plugin = makePlugin([source], { 'note.md': file });

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(1);
    expect(plugin.pendingReImportPaths.has('note.md')).toBe(true);
  });

  it('counts multiple stale sources and adds each to pendingReImportPaths', async () => {
    const sources = [
      makeSource('a.md', 100),
      makeSource('b.md', 200),
      makeSource('c.md', 300),
    ];
    const vaultFiles = {
      'a.md': makeTFile('a.md', 999), // stale
      'b.md': makeTFile('b.md', 200), // fresh
      'c.md': makeTFile('c.md', 888), // stale
    };
    const plugin = makePlugin(sources, vaultFiles);

    const count = await detectStaleSourcesOnStartup(plugin as any);

    expect(count).toBe(2);
    expect(plugin.pendingReImportPaths.has('a.md')).toBe(true);
    expect(plugin.pendingReImportPaths.has('b.md')).toBe(false);
    expect(plugin.pendingReImportPaths.has('c.md')).toBe(true);
  });

  it('does not add non-stale sources to pendingReImportPaths', async () => {
    const sources = [
      makeSource('fresh.md', 500),
      makeSource('stale.md', 100),
    ];
    const vaultFiles = {
      'fresh.md': makeTFile('fresh.md', 500),
      'stale.md': makeTFile('stale.md', 999),
    };
    const plugin = makePlugin(sources, vaultFiles);

    await detectStaleSourcesOnStartup(plugin as any);

    expect(plugin.pendingReImportPaths.has('fresh.md')).toBe(false);
    expect(plugin.pendingReImportPaths.has('stale.md')).toBe(true);
  });
});
