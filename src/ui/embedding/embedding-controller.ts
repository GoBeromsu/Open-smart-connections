/**
 * @file embedding/embedding-controller.ts
 * @description Simplified embedding lifecycle controller (QMD-style).
 *
 * Replaces:
 *   - kernel/ directory (store, reducer, types, effects, selectors, queue)
 *   - file-watcher.ts debounce/defer logic
 *   - embedding-manager.ts run orchestration
 *
 * Flow:  file change -> markDirty() -> [debounce] -> importChangedSources() -> embedUnembedded() -> idle
 */

import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../../main';
import { DebounceController } from '../../shared/debounce-controller';
import { CONNECTIONS_VIEW_TYPE } from '../connections/ConnectionsView';
import { getCurrentModelInfo } from './embedding-manager';

// ── Types ────────────────────────────────────────────────────────────────

export type EmbeddingPhase = 'idle' | 'importing' | 'embedding' | 'error';

export interface EmbeddingProgress {
  current: number;
  total: number;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
}

export interface EmbeddingModelInfo {
  adapter: string;
  modelKey: string;
  dims: number | null;
}

export interface EmbeddingState {
  phase: EmbeddingPhase;
  progress: EmbeddingProgress | null;
  paused: boolean;
  error: string | null;
  model: EmbeddingModelInfo | null;
}

/** Lightweight status for UI consumers (status bar, settings) */
export type EmbedStatusState = 'idle' | 'embedding' | 'error';

// ── Controller ───────────────────────────────────────────────────────────

export class EmbeddingController {
  state: EmbeddingState = {
    phase: 'idle',
    progress: null,
    paused: false,
    error: null,
    model: null,
  };

  private debounce: DebounceController;
  private disposed = false;
  private embedRunSeq = 0;
  private activeRunId: number | null = null;

  constructor(private plugin: SmartConnectionsPlugin) {
    this.debounce = this.createDebounce();
  }

  // ── Derived getters for backward compatibility ───────────────────────

  get statusState(): EmbedStatusState {
    switch (this.state.phase) {
      case 'importing':
      case 'embedding':
        return 'embedding';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  }

  get embedReady(): boolean {
    return !!this.plugin.embed_model && this.state.phase !== 'error';
  }

  // ── Public API ───────────────────────────────────────────────────────

  markDirty(): void {
    if (this.disposed || this.state.paused) return;
    this.debounce.markDirty();
  }

  async flushNow(): Promise<void> {
    if (this.disposed) return;
    this.debounce.dispose();
    await this.run();
  }

  pause(): void {
    this.state.paused = true;
    this.debounce.dispose();
    this.plugin.embedding_pipeline?.halt();
    this.emitStateChange();
  }

  resume(): void {
    this.state.paused = false;
    this.debounce = this.createDebounce();
    this.emitStateChange();
  }

  dispose(): void {
    this.disposed = true;
    this.debounce.dispose();
  }

  /**
   * Update model info in state (called after model switch succeeds).
   */
  setModel(info: EmbeddingModelInfo | null): void {
    this.state.model = info;
    this.emitStateChange();
  }

  /**
   * Set phase to error (called by model switch on failure).
   */
  setError(error: string): void {
    this.state.phase = 'error';
    this.state.error = error;
    this.state.progress = null;
    this.emitStateChange();
  }

  /**
   * Clear error and return to idle.
   */
  resetError(): void {
    if (this.state.phase === 'error') {
      this.state.phase = 'idle';
      this.state.error = null;
      this.emitStateChange();
    }
  }

  // ── State emission ───────────────────────────────────────────────────

  private emitStateChange(): void {
    this.plugin.app.workspace.trigger(
      'smart-connections:embed-state-changed' as any,
      { state: this.state },
    );
    this.plugin.refreshStatus();
  }

  private createDebounce(): DebounceController {
    return new DebounceController({
      delayMs: (this.plugin.settings.re_import_wait_time || 13) * 1000,
      onRun: () => this.run(),
    });
  }

  // ── Main run (called by DebounceController.onRun or flushNow) ──────

  private async run(): Promise<void> {
    if (this.disposed || this.state.paused || this.plugin._unloading) return;
    if (!this.plugin.source_collection || !this.plugin.embedding_pipeline) return;

    try {
      // Phase 1: Import changed sources
      this.state.phase = 'importing';
      this.state.error = null;
      this.emitStateChange();

      await this.importChangedSources();
      if (this.plugin._unloading || this.state.paused) return;

      // Phase 2: Embed unembedded entities
      this.state.phase = 'embedding';
      this.emitStateChange();

      await this.embedUnembedded();

      this.state.phase = 'idle';
      this.state.progress = null;
      this.emitStateChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.phase = 'error';
      this.state.error = message;
      this.state.progress = null;
      this.emitStateChange();
      this.plugin.logger.error('Embedding cycle failed:', error);
    }
  }

  // ── Phase 1: Import ──────────────────────────────────────────────────

  private async importChangedSources(): Promise<void> {
    if (!this.plugin.embed_job_queue || !this.plugin.source_collection) return;

    const paths = this.plugin.embed_job_queue
      .toArray()
      .filter((j) => !j.entityKey.includes('#'))
      .map((j) => j.entityKey);

    if (paths.length === 0) return;

    this.plugin.logger.info(`Importing ${paths.length} sources...`);
    const processed: string[] = [];

    for (const path of paths) {
      if (this.plugin._unloading || this.state.paused) break;

      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.plugin.source_collection.import_source(file);
      }
      processed.push(path);
    }

    // Remove processed source-level entries from queue
    for (const path of processed) {
      this.plugin.embed_job_queue.remove(path);
    }
  }

  // ── Phase 2: Embed ───────────────────────────────────────────────────

  private async embedUnembedded(): Promise<void> {
    if (!this.plugin.source_collection || !this.plugin.embedding_pipeline) return;
    if (this.plugin.embedding_pipeline.is_active()) return;

    // Scan for unembedded entities and enqueue them
    this.queueUnembeddedEntities();

    // Collect entities to embed
    const jobKeys = this.plugin.embed_job_queue
      ? new Set(this.plugin.embed_job_queue.toArray().map((j) => j.entityKey))
      : new Set<string>();

    const sourcesToEmbed = this.plugin.source_collection.all.filter(
      (s: any) => s._queue_embed && s.should_embed && jobKeys.has(s.key),
    );
    const blocksToEmbed = (this.plugin.block_collection?.all || []).filter(
      (b: any) => b._queue_embed && b.should_embed && jobKeys.has(b.key),
    );
    const entities = [...sourcesToEmbed, ...blocksToEmbed];

    if (entities.length === 0) return;

    const runId = ++this.embedRunSeq;
    this.activeRunId = runId;

    this.state.progress = {
      current: 0,
      total: entities.length,
      currentEntityKey: entities[0]?.key ?? null,
      currentSourcePath: entities[0]?.key?.split('#')[0] ?? null,
    };
    this.emitStateChange();

    const model = getCurrentModelInfo(this.plugin);
    this.plugin.logger.info(
      `Embedding ${entities.length} entities (${model.adapter}/${model.modelKey})`,
    );
    this.emitProgress(runId, 'running');

    try {
      const stats = await this.plugin.embedding_pipeline.process(entities, {
        batch_size: 10,
        max_retries: 3,
        on_progress: (current: number, total: number, progress?: { current_key: string | null; current_source_path: string | null }) => {
          if (this.activeRunId !== runId) return;
          this.state.progress = {
            current,
            total,
            currentEntityKey: progress?.current_key ?? this.state.progress?.currentEntityKey ?? null,
            currentSourcePath: progress?.current_source_path ?? this.state.progress?.currentSourcePath ?? null,
          };
          this.emitStateChange();
          this.emitProgress(runId, 'running');
          this.updateNotice();
        },
        on_save: () => this.saveCollections(),
        save_interval: 50,
      });

      if (this.activeRunId !== runId) return;

      await this.saveCollections();
      this.plugin.notices.show('embedding_complete', { success: stats.success });
      this.plugin.embed_job_queue?.clear();
      this.queueUnembeddedEntities();
    } catch (error) {
      if (this.activeRunId !== runId) return;
      this.emitProgress(runId, 'failed', { error: error instanceof Error ? error.message : String(error) });
      this.plugin.notices.show('embedding_failed');
      throw error;
    } finally {
      if (this.activeRunId === runId) {
        this.emitProgress(runId, 'completed', { done: true });
        this.activeRunId = null;
        this.plugin.notices.remove('embedding_progress');
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private queueUnembeddedEntities(): number {
    let queued = 0;
    const now = Date.now();

    const enqueue = (entity: any): void => {
      if (!entity.is_unembedded) return;
      entity.queue_embed();
      if (!entity._queue_embed) return;
      this.plugin.embed_job_queue?.enqueue({
        entityKey: entity.key,
        contentHash: entity.read_hash || '',
        sourcePath: String(entity.key || '').split('#')[0],
        enqueuedAt: now,
      });
      queued++;
    };

    for (const source of this.plugin.source_collection?.all || []) {
      enqueue(source);
    }
    for (const block of this.plugin.block_collection?.all || []) {
      enqueue(block);
    }

    return queued;
  }

  private async saveCollections(): Promise<void> {
    if (!this.plugin.source_collection) return;
    await this.plugin.source_collection.data_adapter.save();
    if (this.plugin.block_collection) {
      await this.plugin.block_collection.data_adapter.save();
    }
  }

  private updateNotice(): void {
    if (!this.state.progress) return;
    const { current, total } = this.state.progress;
    const model = getCurrentModelInfo(this.plugin);
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    // Suppress notice only when ConnectionsView is actually visible (active tab + sidebar expanded)
    const leaves = this.plugin.app.workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
    const isViewVisible = leaves.some((leaf: any) =>
      typeof leaf.view?.containerEl?.checkVisibility === 'function'
        ? leaf.view.containerEl.checkVisibility()
        : false,
    );
    if (isViewVisible) {
      this.plugin.notices.remove('embedding_progress');
      return;
    }

    this.plugin.notices.show(
      'embedding_progress',
      { adapter: model.adapter, modelKey: model.modelKey, current, total, percent },
      { timeout: 0 },
    );
  }

  private emitProgress(
    runId: number,
    phase: 'running' | 'completed' | 'failed',
    opts: { error?: string; done?: boolean } = {},
  ): void {
    const { error, done } = opts;
    const model = getCurrentModelInfo(this.plugin);
    const progress = this.state.progress;
    const current = progress?.current ?? 0;
    const total = progress?.total ?? 0;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    this.plugin.app.workspace.trigger('smart-connections:embed-progress' as any, {
      runId,
      phase,
      adapter: model.adapter,
      modelKey: model.modelKey,
      dims: model.dims,
      currentEntityKey: progress?.currentEntityKey ?? null,
      currentSourcePath: progress?.currentSourcePath ?? null,
      current,
      total,
      percent,
      done,
      error,
    });
  }
}
