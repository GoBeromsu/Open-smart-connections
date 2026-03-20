/**
 * @file embedding-controller.test.ts
 * @description Unit tests for EmbeddingController lifecycle: run, pause, resume, dispose, error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingController } from '../src/ui/embedding/embedding-controller';

/** Minimal plugin stub — just enough for the controller to operate */
function createPluginStub() {
  const plugin = {
    settings: {
      smart_sources: {
        embed_model: { adapter: 'openai', openai: { model_key: 'text-embedding-3-small' } },
      },
      re_import_wait_time: 0.01, // 10ms debounce for fast tests
    },
    embed_model: {
      model_key: 'text-embedding-3-small',
      adapter: { dims: 1536, adapter: 'openai' },
    },
    _unloading: false,
    app: {
      workspace: {
        trigger: vi.fn(),
        getLeavesOfType: vi.fn(() => []),
      },
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => ({ path })),
      },
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    notices: {
      show: vi.fn(),
      remove: vi.fn(),
    },
    refreshStatus: vi.fn(),
    source_collection: {
      all: [] as any[],
      data_adapter: { save: vi.fn(async () => {}) },
      import_source: vi.fn(async () => {}),
    },
    block_collection: {
      all: [] as any[],
      data_adapter: { save: vi.fn(async () => {}) },
    },
    embedding_pipeline: {
      is_active: vi.fn(() => false),
      halt: vi.fn(),
      process: vi.fn(async (_entities: any[], opts: any) => {
        opts.on_progress?.(1, 1);
        return { total: 1, success: 1, failed: 0, skipped: 0, duration_ms: 10 };
      }),
    },
    embed_job_queue: {
      toArray: vi.fn(() => []),
      enqueue: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      size: vi.fn(() => 0),
    },
  } as any;

  return plugin;
}

describe('EmbeddingController', () => {
  describe('initial state', () => {
    it('starts in idle phase', () => {
      const plugin = createPluginStub();
      const controller = new EmbeddingController(plugin);
      expect(controller.state.phase).toBe('idle');
      expect(controller.state.paused).toBe(false);
      expect(controller.state.error).toBeNull();
      expect(controller.state.progress).toBeNull();
    });
  });

  describe('statusState / embedReady', () => {
    it('idle → "idle"', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      expect(c.statusState).toBe('idle');
    });

    it('importing → "embedding"', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.state.phase = 'importing';
      expect(c.statusState).toBe('embedding');
    });

    it('embedding → "embedding"', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.state.phase = 'embedding';
      expect(c.statusState).toBe('embedding');
    });

    it('error → "error"', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.setError('fail');
      expect(c.statusState).toBe('error');
    });

    it('embedReady true when model exists and not error', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      expect(c.embedReady).toBe(true);
    });

    it('embedReady false in error state', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.setError('fail');
      expect(c.embedReady).toBe(false);
    });

    it('embedReady false without embed_model', () => {
      const plugin = createPluginStub();
      plugin.embed_model = undefined;
      const c = new EmbeddingController(plugin);
      expect(c.embedReady).toBe(false);
    });
  });

  describe('setError / resetError', () => {
    it('setError transitions to error with message', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.setError('API key expired');
      expect(c.state.phase).toBe('error');
      expect(c.state.error).toBe('API key expired');
      expect(c.state.progress).toBeNull();
    });

    it('resetError returns to idle from error', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.setError('fail');
      c.resetError();
      expect(c.state.phase).toBe('idle');
      expect(c.state.error).toBeNull();
    });

    it('resetError is no-op when not in error', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.resetError(); // should not change anything
      expect(c.state.phase).toBe('idle');
    });
  });

  describe('setModel', () => {
    it('updates model info and emits state change', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.setModel({ adapter: 'openai', modelKey: 'text-embedding-3-large', dims: 3072 });
      expect(c.state.model?.modelKey).toBe('text-embedding-3-large');
      expect(c.state.model?.dims).toBe(3072);
      expect(plugin.app.workspace.trigger).toHaveBeenCalledWith(
        'smart-connections:embed-state-changed',
        expect.objectContaining({ state: c.state }),
      );
    });
  });

  describe('pause / resume', () => {
    it('pause sets paused, halts pipeline', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.pause();
      expect(c.state.paused).toBe(true);
      expect(plugin.embedding_pipeline.halt).toHaveBeenCalled();
    });

    it('resume clears paused', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.pause();
      c.resume();
      expect(c.state.paused).toBe(false);
    });

    it('markDirty is no-op when paused', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.pause();
      c.markDirty(); // should not throw or schedule anything
      expect(c.state.paused).toBe(true);
    });
  });

  describe('dispose', () => {
    it('prevents markDirty after dispose', () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.dispose();
      c.markDirty(); // should not throw or schedule
    });

    it('prevents flushNow after dispose', async () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      c.dispose();
      await c.flushNow();
      expect(c.state.phase).toBe('idle');
    });
  });

  describe('run lifecycle', () => {
    it('transitions idle → importing → embedding → idle on flushNow', async () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);
      const phases: string[] = [];

      plugin.app.workspace.trigger.mockImplementation((event: string, payload: any) => {
        if (event === 'smart-connections:embed-state-changed') {
          phases.push(payload.state.phase);
        }
      });

      // Add source needing embedding
      plugin.source_collection.all = [
        { key: 'note.md', _queue_embed: true, should_embed: true, is_unembedded: true, queue_embed: vi.fn(), read_hash: 'h1' },
      ];
      plugin.embed_job_queue.toArray.mockReturnValue([
        { entityKey: 'note.md', contentHash: 'h1', sourcePath: 'note.md', enqueuedAt: Date.now() },
      ]);

      await c.flushNow();

      expect(phases).toContain('importing');
      expect(phases).toContain('embedding');
      expect(c.state.phase).toBe('idle');
    });

    it('sets error state when pipeline.process throws', async () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);

      plugin.source_collection.all = [
        { key: 'fail.md', _queue_embed: true, should_embed: true, is_unembedded: true, queue_embed: vi.fn(), read_hash: 'h1' },
      ];
      plugin.embed_job_queue.toArray.mockReturnValue([
        { entityKey: 'fail.md', contentHash: 'h1', sourcePath: 'fail.md', enqueuedAt: Date.now() },
      ]);
      plugin.embedding_pipeline.process.mockRejectedValueOnce(new Error('Network error'));

      await c.flushNow();

      expect(c.state.phase).toBe('error');
      expect(c.state.error).toBe('Network error');
    });

    it('skips run when no source_collection', async () => {
      const plugin = createPluginStub();
      plugin.source_collection = undefined;
      const c = new EmbeddingController(plugin);
      await c.flushNow();
      expect(c.state.phase).toBe('idle');
    });

    it('skips run when no embedding_pipeline', async () => {
      const plugin = createPluginStub();
      plugin.embedding_pipeline = undefined;
      const c = new EmbeddingController(plugin);
      await c.flushNow();
      expect(c.state.phase).toBe('idle');
    });

    it('skips embed when pipeline is already active', async () => {
      const plugin = createPluginStub();
      plugin.embedding_pipeline.is_active.mockReturnValue(true);
      const c = new EmbeddingController(plugin);

      plugin.embed_job_queue.toArray.mockReturnValue([
        { entityKey: 'note.md', contentHash: '', sourcePath: 'note.md', enqueuedAt: Date.now() },
      ]);

      await c.flushNow();
      expect(plugin.embedding_pipeline.process).not.toHaveBeenCalled();
    });

    it('skips run when plugin is unloading', async () => {
      const plugin = createPluginStub();
      plugin._unloading = true;
      const c = new EmbeddingController(plugin);

      plugin.embed_job_queue.toArray.mockReturnValue([
        { entityKey: 'note.md', contentHash: '', sourcePath: 'note.md', enqueuedAt: Date.now() },
      ]);
      await c.flushNow();

      expect(c.state.phase).toBe('idle');
      expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
    });

    it('bails from import phase when paused mid-run', async () => {
      const plugin = createPluginStub();
      const c = new EmbeddingController(plugin);

      plugin.source_collection.import_source.mockImplementation(async () => {
        c.pause();
      });
      plugin.embed_job_queue.toArray.mockReturnValue([
        { entityKey: 'note.md', contentHash: '', sourcePath: 'note.md', enqueuedAt: Date.now() },
      ]);

      await c.flushNow();
      expect(plugin.embedding_pipeline.process).not.toHaveBeenCalled();
    });
  });
});
