/**
 * @file file-watcher-source-guard.test.ts
 * @description TDD tests for the missing isSourceFile guard on editor-change
 *              and active-leaf-change handlers in file-watcher.ts.
 *
 * CURRENT STATE (red phase): the handlers currently call debounceReImport
 * unconditionally — there is no file check.  These tests describe the desired
 * behaviour and are expected to fail until the guard is added.
 *
 * Desired behaviour:
 *   - editor-change fires debounceReImport ONLY when the active file is a
 *     valid source file (.md / .txt, not excluded)
 *   - active-leaf-change fires debounceReImport ONLY when the new leaf's file
 *     is a valid source file
 *   - Both handlers fire debounceReImport for a normal .md file
 *   - Neither handler fires debounceReImport when no file is active
 *   - Neither handler fires debounceReImport for excluded / non-source files
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { registerFileWatchers } from '../../src/ui/file-watcher';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTFile(path: string): any {
  const f = Object.create(TFile.prototype);
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const dotIndex = filename.lastIndexOf('.');
  f.path = path;
  f.basename = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  f.extension = dotIndex >= 0 ? filename.substring(dotIndex + 1) : '';
  f.stat = { mtime: Date.now(), size: 500 };
  return f;
}

type WorkspaceEventName = 'editor-change' | 'active-leaf-change';

function makePlugin(activeFile: any | null = null): {
  plugin: any;
  fireWorkspaceEvent: (name: WorkspaceEventName, leaf?: any) => void;
} {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};

  const plugin: any = {
    _unloading: false,
    re_import_timeout: undefined,
    pendingReImportPaths: new Set<string>(),
    settings: {
      re_import_wait_time: 13,
      smart_sources: { folder_exclusions: '', file_exclusions: '' },
    },
    embedding_pipeline: { is_active: vi.fn(() => false) },
    source_collection: { import_source: vi.fn(async () => {}) },
    block_collection: { all: [], delete_source_blocks: vi.fn() },
    app: {
      vault: {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[`vault:${event}`] = handlers[`vault:${event}`] ?? [];
          handlers[`vault:${event}`].push(handler);
          return { event, handler };
        }),
        getAbstractFileByPath: vi.fn(() => null),
        adapter: {},
        configDir: '.obsidian',
        getName: () => 'test-vault',
      },
      workspace: {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[`workspace:${event}`] = handlers[`workspace:${event}`] ?? [];
          handlers[`workspace:${event}`].push(handler);
          return { event, handler };
        }),
        // Returns the currently active file (used by the guard)
        getActiveFile: vi.fn(() => activeFile),
      },
    },
    registerEvent: vi.fn(),
    enqueueEmbeddingJob: vi.fn(async () => {}),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    notices: { show: vi.fn() },
    status_msg: { setText: vi.fn() },
    refreshStatus: vi.fn(),
    logEmbed: vi.fn(),
    queueUnembeddedEntities: vi.fn(() => 0),
    setEmbedPhase: vi.fn(),
  };

  // registerEvent is a pass-through — capture the handler reference
  plugin.registerEvent = vi.fn((ref: any) => ref);

  // Wire up workspace.on to capture handlers directly
  const workspaceHandlers: Record<string, (...args: any[]) => void> = {};
  plugin.app.workspace.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
    workspaceHandlers[event] = handler;
    return { event, handler };
  });
  plugin.app.vault.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
    return { event, handler };
  });

  // Call registerFileWatchers to wire up all handlers
  registerFileWatchers(plugin);

  function fireWorkspaceEvent(name: WorkspaceEventName, leaf?: any): void {
    const handler = workspaceHandlers[name];
    if (handler) handler(leaf);
  }

  return { plugin, fireWorkspaceEvent };
}

// ── editor-change ─────────────────────────────────────────────────────────────

describe('editor-change handler — isSourceFile guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls debounceReImport when the active file is a .md source file', () => {
    const mdFile = makeTFile('notes/my-note.md');
    const { plugin, fireWorkspaceEvent } = makePlugin(mdFile);

    fireWorkspaceEvent('editor-change');

    // debounceReImport sets re_import_timeout
    expect(plugin.re_import_timeout).toBeDefined();
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });

  it('does NOT call debounceReImport when no file is active', () => {
    const { plugin, fireWorkspaceEvent } = makePlugin(null);

    fireWorkspaceEvent('editor-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('does NOT call debounceReImport when the active file is a non-source extension', () => {
    const pdfFile = makeTFile('attachments/diagram.pdf');
    const { plugin, fireWorkspaceEvent } = makePlugin(pdfFile);

    fireWorkspaceEvent('editor-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('does NOT call debounceReImport when the active file is in an excluded folder', () => {
    const excludedFile = makeTFile('node_modules/some-lib/README.md');
    const { plugin, fireWorkspaceEvent } = makePlugin(excludedFile);

    fireWorkspaceEvent('editor-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('calls debounceReImport for a .txt source file', () => {
    const txtFile = makeTFile('notes/journal.txt');
    const { plugin, fireWorkspaceEvent } = makePlugin(txtFile);

    fireWorkspaceEvent('editor-change');

    expect(plugin.re_import_timeout).toBeDefined();
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });
});

// ── active-leaf-change ────────────────────────────────────────────────────────

describe('active-leaf-change handler — isSourceFile guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls debounceReImport when the active file is a .md source file', () => {
    const mdFile = makeTFile('notes/my-note.md');
    const { plugin, fireWorkspaceEvent } = makePlugin(mdFile);

    fireWorkspaceEvent('active-leaf-change');

    expect(plugin.re_import_timeout).toBeDefined();
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });

  it('does NOT call debounceReImport when no file is active', () => {
    const { plugin, fireWorkspaceEvent } = makePlugin(null);

    fireWorkspaceEvent('active-leaf-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('does NOT call debounceReImport when the active file has a non-source extension', () => {
    const imgFile = makeTFile('images/photo.png');
    const { plugin, fireWorkspaceEvent } = makePlugin(imgFile);

    fireWorkspaceEvent('active-leaf-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('does NOT call debounceReImport when the active file is in an excluded folder', () => {
    const trashFile = makeTFile('.trash/old-note.md');
    const { plugin, fireWorkspaceEvent } = makePlugin(trashFile);

    fireWorkspaceEvent('active-leaf-change');

    expect(plugin.re_import_timeout).toBeUndefined();
  });
});
