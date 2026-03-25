/**
 * @file embed-orchestrator.ts
 * @description Embedding model initialization, pipeline management, run orchestration, notices, and progress events
 */

import type SmartConnectionsPlugin from '../main';
import type { EmbeddingRunContext, EmbedProgressEventPayload } from '../main';
import type { EmbeddingEntity } from '../types/entities';
import { CONNECTIONS_VIEW_TYPE } from './ConnectionsView';

import { embedAdapterRegistry } from '../domain/embed-model';
// Import adapters to trigger self-registration
import './embed-adapters/transformers';
import './embed-adapters/openai';
import './embed-adapters/ollama';
import './embed-adapters/gemini';
import './embed-adapters/lm-studio';
import './embed-adapters/upstage';
import './embed-adapters/open-router';

import {
  EmbeddingPipeline,
  type EmbedQueueStats,
} from '../domain/embedding-pipeline';

import { buildKernelModel } from '../domain/embedding/kernel';
import { errorMessage } from '../utils';

// ── Model info helpers ──────────────────────────────────────────────

export function getCurrentModelInfo(plugin: SmartConnectionsPlugin): { adapter: string; modelKey: string; dims: number | null } {
  const adapter = plugin.embed_adapter?.adapter
    ?? plugin.settings?.smart_sources?.embed_model?.adapter
    ?? 'unknown';
  const modelKey = plugin.embed_adapter?.model_key
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- embed_model shape is dynamic during model switch
    ?? plugin.getEmbedAdapterSettings(plugin.settings?.smart_sources?.embed_model as any)?.model_key
    ?? 'unknown';
  const dims = plugin.embed_adapter?.dims ?? null;
  return { adapter, modelKey, dims };
}

export function getActiveEmbeddingContext(plugin: SmartConnectionsPlugin): EmbeddingRunContext | null {
  if (!plugin.current_embed_context) return null;
  return { ...plugin.current_embed_context };
}

function publishEmbedContext(plugin: SmartConnectionsPlugin, ctx: EmbeddingRunContext): void {
  plugin.current_embed_context = { ...ctx };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

// ── Logging ─────────────────────────────────────────────────────────

const NOISY_EVENTS = new Set([
  'run-progress',
  'run-save',
  'queue-unembedded-entities',
  'reimport-queue-ready',
  'run-skip-empty',
  'run-skip-active',
]);

export function logEmbed(plugin: SmartConnectionsPlugin, event: string, context: Partial<EmbedProgressEventPayload> = {}): void {
  if (NOISY_EVENTS.has(event)) return;

  const runId = context.runId ?? plugin.current_embed_context?.runId ?? '-';
  const current = context.current;
  const total = context.total;
  const progress =
    typeof current === 'number' && typeof total === 'number'
      ? ` ${current}/${total}`
      : '';
  const model =
    context.adapter && context.modelKey
      ? ` ${context.adapter}/${context.modelKey}`
      : '';
  const note = context.currentSourcePath ? ` ${context.currentSourcePath}` : '';
  const reason = context.reason ? ` reason="${context.reason}"` : '';
  const error = context.error ? ` error="${context.error}"` : '';
  plugin.logger.info(`[Embed] ${event} run=${runId}${progress}${model}${note}${reason}${error}`);
}

// ── Notice helpers ──────────────────────────────────────────────────

export function clearEmbedNotice(plugin: SmartConnectionsPlugin): void {
  plugin.notices.remove('embedding_progress');
  plugin.embed_notice_last_update = 0;
  plugin.embed_notice_last_percent = 0;
}

export function updateEmbedNotice(plugin: SmartConnectionsPlugin, ctx: EmbeddingRunContext, force: boolean = false): void {
  const connectionsLeaves = plugin.app.workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE);
  const isViewVisible = connectionsLeaves.some((leaf) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WorkspaceLeaf.view.containerEl is not typed in Obsidian API
    const containerEl = (leaf.view as any)?.containerEl;
    return typeof containerEl?.checkVisibility === 'function' ? containerEl.checkVisibility() : false;
  });
  if (isViewVisible) {
    clearEmbedNotice(plugin);
    return;
  }

  const percent = ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0;
  const now = Date.now();
  const shouldUpdate =
    force ||
    plugin.embed_notice_last_update === 0 ||
    now - plugin.embed_notice_last_update >= 3000 ||
    Math.abs(percent - plugin.embed_notice_last_percent) >= 5;

  if (!shouldUpdate) return;

  plugin.notices.show(
    'embedding_progress',
    {
      adapter: ctx.adapter,
      modelKey: ctx.modelKey,
      current: ctx.current,
      total: ctx.total,
      percent,
    },
    { timeout: 0 },
  );
  plugin.embed_notice_last_update = now;
  plugin.embed_notice_last_percent = percent;
}

// ── Progress event emission ─────────────────────────────────────────

export function emitEmbedProgress(
  plugin: SmartConnectionsPlugin,
  ctx: EmbeddingRunContext,
  opts: { done?: boolean; error?: string } = {},
): void {
  const elapsedMs = Date.now() - ctx.startedAt;
  const percent = ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0;
  const payload: EmbedProgressEventPayload = {
    runId: ctx.runId,
    phase: ctx.phase,
    outcome: ctx.outcome,
    reason: ctx.reason,
    adapter: ctx.adapter,
    modelKey: ctx.modelKey,
    dims: ctx.dims,
    currentEntityKey: ctx.currentEntityKey,
    currentSourcePath: ctx.currentSourcePath,
    current: ctx.current,
    total: ctx.total,
    percent,
    blockTotal: ctx.blockTotal,
    saveCount: ctx.saveCount,
    sourceDataDir: ctx.sourceDataDir,
    blockDataDir: ctx.blockDataDir,
    startedAt: ctx.startedAt,
    elapsedMs,
    followupQueued: ctx.followupQueued,
    done: opts.done,
    error: opts.error ?? ctx.error ?? undefined,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom workspace event not in Obsidian types
  plugin.app.workspace.trigger('open-connections:embed-progress' as any, payload);
}

// ── Model initialization ────────────────────────────────────────────

export async function initEmbedModel(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const embedSettings = plugin.settings.smart_sources.embed_model;
    const adapterType = embedSettings.adapter;
    const adapterSettings = plugin.getEmbedAdapterSettings(embedSettings);
    const modelKey = adapterSettings.model_key || '';

    const { adapter, requiresLoad } = embedAdapterRegistry.createAdapter(
      adapterType,
      modelKey,
      adapterSettings,
    );

    if (requiresLoad && typeof (adapter as { load?: () => Promise<void> }).load === 'function') {
      await (adapter as { load: () => Promise<void> }).load();
    }

    plugin.embed_adapter = adapter;
    plugin.logger.info(`[Init] Embed model initialized (${adapterType}/${modelKey})`);
  } catch (error) {
    plugin.logger.error('[Init] Failed to initialize embed model', error);
    const message = errorMessage(error);
    if (plugin.settings.smart_sources.embed_model.adapter === 'transformers') {
      if (/\[download:timeout\]/i.test(message)) {
        plugin.notices.show('failed_download_timeout', {}, { timeout: 10000 });
      } else if (/\[download:quota\]/i.test(message)) {
        plugin.notices.show('failed_download_quota', {}, { timeout: 10000 });
      } else if (/\[download:network\]/i.test(message)) {
        plugin.notices.show('failed_download_network', {}, { timeout: 10000 });
      } else if (/\[download:model_not_found\]/i.test(message)) {
        const modelKey = plugin.settings.smart_sources.embed_model.transformers?.model_key ?? 'unknown';
        plugin.notices.show('failed_download_model_not_found', { modelKey }, { timeout: 10000 });
      } else if (/(failed to fetch|network|cdn|timed out)/i.test(message)) {
        plugin.notices.show('failed_download_transformers_model', { error: message }, { timeout: 8000 });
      }
    }
    plugin.notices.show('failed_init_embed_model');
    throw error;
  }
}

// ── Search model initialization ─────────────────────────────────────

export async function initSearchEmbedModel(plugin: SmartConnectionsPlugin): Promise<void> {
  const searchModelSettings = plugin.settings.smart_sources.search_model;
  if (!searchModelSettings?.adapter || !searchModelSettings?.model_key) {
    plugin._search_embed_model = undefined;
    return;
  }

  const embedSettings = plugin.settings.smart_sources.embed_model;
  const indexingAdapterSettings = plugin.getEmbedAdapterSettings(embedSettings);
  if (
    searchModelSettings.adapter === embedSettings.adapter &&
    searchModelSettings.model_key === (indexingAdapterSettings.model_key || '')
  ) {
    plugin._search_embed_model = undefined;
    return;
  }

  try {
    const searchAdapterSettings = searchModelSettings.adapter === embedSettings.adapter
      ? { ...indexingAdapterSettings }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- embed_model sub-key lookup is dynamic per adapter
      : { ...(embedSettings[searchModelSettings.adapter as keyof typeof embedSettings] as Record<string, any> || {}) };

    const { adapter, requiresLoad } = embedAdapterRegistry.createAdapter(
      searchModelSettings.adapter,
      searchModelSettings.model_key,
      searchAdapterSettings,
    );

    if (requiresLoad && typeof (adapter as { load?: () => Promise<void> }).load === 'function') {
      await (adapter as { load: () => Promise<void> }).load();
    }

    plugin._search_embed_model = adapter;
    plugin.logger.info(`[Init] Search model initialized (${searchModelSettings.adapter}/${searchModelSettings.model_key})`);
  } catch (_error) {
    plugin.logger.warn('[Init] Failed to initialize search model, will use indexing model');
    plugin._search_embed_model = undefined;
  }
}

// ── Pipeline initialization ─────────────────────────────────────────

export function initPipeline(plugin: SmartConnectionsPlugin): void {
  if (!plugin.embed_adapter) {
    plugin.notices.show('failed_init_embed_pipeline');
    throw new Error('Embed adapter must be initialized before pipeline');
  }
  plugin.embedding_pipeline = new EmbeddingPipeline(plugin.embed_adapter);
  plugin.logger.debug('[SC][Init]   [pipeline] Embedding pipeline initialized');
}

// ── Re-embed stale entities ─────────────────────────────────────────

export async function reembedStaleEntities(plugin: SmartConnectionsPlugin, reason: string = 'Manual re-embed'): Promise<number> {
  return plugin.enqueueEmbeddingJob({
    type: 'REFRESH_REQUEST',
    key: 'REFRESH_REQUEST',
    priority: 20,
    run: async () => {
      // Reset both error message AND phase — without phase reset, runEmbeddingJobNow
      // returns null when status_state === 'error', silently discarding the re-embed.
      plugin.resetError();
      plugin.setEmbedPhase('idle');
      const queued = plugin.queueUnembeddedEntities();
      if (queued === 0) {
        plugin.logEmbed('reembed-skip-empty', { reason });
        return 0;
      }
      await runEmbeddingJobNow(plugin, reason);
      return queued;
    },
  });
}

// ── Model switch ────────────────────────────────────────────────────

export async function switchEmbeddingModel(plugin: SmartConnectionsPlugin, reason: string = 'Embedding model switch'): Promise<void> {
  await plugin.enqueueEmbeddingJob({
    type: 'MODEL_SWITCH',
    key: 'MODEL_SWITCH',
    priority: 5,
    run: () => switchEmbeddingModelNow(plugin, reason),
  });
}

async function unloadPreviousModel(plugin: SmartConnectionsPlugin): Promise<void> {
  if (plugin._search_embed_model?.unload) {
    try {
      await plugin._search_embed_model.unload();
    } catch (error) {
      plugin.logger.warn('Failed to unload previous search embed model during switch', { error: String(error) });
    }
    plugin._search_embed_model = undefined;
  }

  if (!plugin.embed_adapter) return;
  try {
    await plugin.embed_adapter.unload?.();
  } catch (error) {
    plugin.logger.warn('Failed to unload previous embed model during switch', { error: String(error) });
  }
}

function getModelLoadTimeoutMs(plugin: SmartConnectionsPlugin): number {
  const embedModel = plugin.settings?.smart_sources?.embed_model;
  if (!embedModel) return 180000;
  const targetAdapterSettings = plugin.getEmbedAdapterSettings(embedModel) as Record<string, unknown>;
  const configuredLoadTimeoutMs = Number(targetAdapterSettings?.request_timeout_ms);
  return Number.isFinite(configuredLoadTimeoutMs) && configuredLoadTimeoutMs > 0
    ? configuredLoadTimeoutMs
    : 180000;
}

async function switchEmbeddingModelNow(plugin: SmartConnectionsPlugin, reason: string = 'Embedding model switch'): Promise<void> {
  plugin.resetError();
  const previous = getCurrentModelInfo(plugin);
  const previousModelKey = plugin.embed_adapter?.model_key ?? '';
  const embedModel = plugin.settings?.smart_sources?.embed_model;
  const targetAdapterSettings = embedModel
    ? (plugin.getEmbedAdapterSettings(embedModel) as Record<string, unknown>)
    : null;
  const targetAdapter = embedModel?.adapter ?? '';
  const targetModelKey = String(targetAdapterSettings?.model_key ?? '');
  const shouldForceReembed =
    !!plugin.embed_adapter && (previousModelKey !== targetModelKey || previous.adapter !== targetAdapter);
  plugin.logEmbed('switch-start', {
    reason,
    adapter: previous.adapter,
    modelKey: previous.modelKey,
    dims: previous.dims,
  });

  try {
    if (plugin.embedding_pipeline?.is_active()) {
      plugin.embedding_pipeline.halt();
      plugin.logEmbed('switch-halt-pipeline', {
        reason,
        adapter: previous.adapter,
        modelKey: previous.modelKey,
        dims: previous.dims,
      });
    }

    await unloadPreviousModel(plugin);

    const modelLoadTimeoutMs = getModelLoadTimeoutMs(plugin);
    await withTimeout(
      plugin.initEmbedModel(),
      modelLoadTimeoutMs,
      `Timed out while loading embedding model (${targetAdapter}/${targetModelKey}).`,
    );

    await initSearchEmbedModel(plugin);
    plugin.syncCollectionEmbeddingContext();

    if (shouldForceReembed) {
      let forced = 0;
      const allEntities = [
        ...(plugin.source_collection?.all || []),
        ...(plugin.block_collection?.all || []),
      ];
      for (const entity of allEntities) {
        if (!entity) continue;
        entity.set_active_embedding_meta?.({ hash: '' });
        entity.queue_embed?.();
        forced++;
      }
      plugin.logEmbed('switch-force-reembed', {
        reason,
        adapter: targetAdapter,
        modelKey: targetModelKey,
        current: forced,
        total: forced,
      });
    }

    const queuedAfterSync = plugin.queueUnembeddedEntities();

    if (queuedAfterSync > 0) {
      const mk = plugin.block_collection?.embed_model_key ?? '';
      const expectedDims = plugin.embed_adapter?.dims;
      let missingMeta = 0, hashMismatch = 0, dimsMismatch = 0;
      for (const entity of (plugin.block_collection?.all ?? [])) {
        if (!entity.is_unembedded) continue;
        const meta = entity.data.embedding_meta?.[mk];
        if (!meta) { missingMeta++; continue; }
        const readHash = entity.data.last_read?.hash;
        if (!readHash || meta.hash !== readHash) { hashMismatch++; continue; }
        if (typeof expectedDims === 'number' && expectedDims > 0 && typeof meta.dims === 'number' && meta.dims > 0 && meta.dims !== expectedDims) {
          dimsMismatch++;
        }
      }
      plugin.logEmbed('switch-queued', { adapter: targetAdapter, modelKey: targetModelKey, current: queuedAfterSync, total: queuedAfterSync });
      plugin.logger.debug('[SC][Embed] switch-queued breakdown', { missingMeta, hashMismatch, dimsMismatch });
    }

    await saveCollections(plugin);
    await plugin.initPipeline();

    // Notify success
    const active = getCurrentModelInfo(plugin);
    const activeEmbedModel = plugin.settings?.smart_sources?.embed_model;
    const activeAdapterSettings = activeEmbedModel
      ? (plugin.getEmbedAdapterSettings(activeEmbedModel) as Record<string, unknown>)
      : null;
    const kernelModel = buildKernelModel(
      active.adapter,
      active.modelKey,
      String(activeAdapterSettings?.host || ''),
      active.dims,
    );
    plugin.setEmbedPhase('idle', { fingerprint: kernelModel.fingerprint });
    plugin.app.workspace.trigger('open-connections:embed-ready');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom workspace event not in Obsidian types
    plugin.app.workspace.trigger('open-connections:model-switched' as any, {
      ...active,
      switchedAt: Date.now(),
    });
    plugin.logEmbed('switch-ready', {
      reason,
      ...active,
      current: queuedAfterSync,
      total: queuedAfterSync,
    });
    plugin.logger.info('[SC][Init] Model switch complete', { adapter: active.adapter, modelKey: active.modelKey, queued: queuedAfterSync });
  } catch (error) {
    plugin.setEmbedPhase('error', { error: errorMessage(error) });
    plugin.logEmbed('switch-failed', {
      reason,
      error: errorMessage(error),
    });
    throw error;
  }
}

// ── Collection save helper ──────────────────────────────────────────

async function saveCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection) return;
  await plugin.source_collection.data_adapter.save();
  if (plugin.block_collection) {
    await plugin.block_collection.data_adapter.save();
  }
}

function scheduleFollowupRun(plugin: SmartConnectionsPlugin, reason: string, runId: number): void {
  void plugin.enqueueEmbeddingJob({
    type: 'RUN_EMBED_FOLLOWUP',
    key: `RUN_EMBED_FOLLOWUP:${runId}`,
    priority: 31,
    run: async () => runEmbeddingJobNow(plugin, reason),
  }).catch((error) => {
    plugin.logger.warn('[SC] Failed to schedule embedding follow-up run', { error: String(error) });
  });
}

// ── Main embedding job ──────────────────────────────────────────────

export async function runEmbeddingJob(plugin: SmartConnectionsPlugin, reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> {
  return plugin.enqueueEmbeddingJob({
    type: 'RUN_EMBED_BATCH',
    key: 'RUN_EMBED_BATCH',
    priority: 30,
    run: async () => runEmbeddingJobNow(plugin, reason),
  });
}

export async function runEmbeddingJobNow(plugin: SmartConnectionsPlugin, reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> {
  if (plugin.status_state === 'error') {
    plugin.logger.warn('[SC] runEmbeddingJobNow rejected: embed phase is error');
    return null;
  }

  if (plugin._unloading) {
    plugin.logger.warn('[SC] runEmbeddingJobNow rejected: plugin is unloading');
    return null;
  }

  if (!plugin.source_collection || !plugin.embedding_pipeline) {
    return null;
  }

  if (plugin.embedding_pipeline.is_active()) {
    plugin.logEmbed('run-skip-active', { reason });
    return null;
  }

  const entitiesToEmbed = (plugin.block_collection?.all || []).filter(
    (b: EmbeddingEntity) => b._queue_embed && b.should_embed,
  );

  if (entitiesToEmbed.length === 0) {
    plugin.logEmbed('run-skip-empty', { reason });
    return null;
  }

  const model = getCurrentModelInfo(plugin);
  const runId = ++plugin.embed_run_seq;
  const firstEntity = entitiesToEmbed[0];
  const ctx: EmbeddingRunContext = {
    runId,
    phase: 'running',
    outcome: undefined,
    reason,
    adapter: model.adapter,
    modelKey: model.modelKey,
    dims: model.dims,
    currentEntityKey: firstEntity?.key ?? null,
    currentSourcePath: firstEntity?.key?.split('#')[0] ?? null,
    startedAt: Date.now(),
    current: 0,
    total: entitiesToEmbed.length,
    blockTotal: entitiesToEmbed.length,
    saveCount: 0,
    sourceDataDir: plugin.source_collection.data_dir,
    blockDataDir: plugin.block_collection?.data_dir ?? '',
    followupQueued: false,
    error: null,
  };

  publishEmbedContext(plugin, ctx);
  plugin.setEmbedPhase('running');
  updateEmbedNotice(plugin, ctx, true);
  emitEmbedProgress(plugin, ctx);
  plugin.logEmbed('run-start', {
    runId,
    reason,
    adapter: ctx.adapter,
    modelKey: ctx.modelKey,
    dims: ctx.dims,
    current: 0,
    total: ctx.total,
    blockTotal: ctx.blockTotal,
    sourceDataDir: ctx.sourceDataDir,
    blockDataDir: ctx.blockDataDir,
  });

  let unresolvedAfterRun = 0;
  let lastProgressEmit = 0;

  try {
    const dims = ctx.dims ?? 384;
    // High-dim models (>1024d, e.g. Upstage 4096d) generate large vectors per entity.
    // More frequent saves → faster evictVec() → less heap pressure when autosave fires.
    // Concurrency is capped at 3 to avoid simultaneous large allocations in memory.
    const effectiveSaveInterval = dims > 1024 ? 2 : dims > 512 ? 3 : (plugin.settings.embed_save_interval || 5);
    const effectiveConcurrency = dims > 1024
      ? Math.max(1, Math.min(plugin.settings.embed_concurrency || 5, 3))
      : (plugin.settings.embed_concurrency || 5);

    const stats = await plugin.embedding_pipeline.process(entitiesToEmbed, {
      batch_size: 10,
      max_retries: 3,
      concurrency: effectiveConcurrency,
      on_progress: (current, total, progress) => {
        if (plugin.current_embed_context?.runId !== runId) return;
        ctx.current = current;
        ctx.total = total;
        if (progress?.current_key) ctx.currentEntityKey = progress.current_key;
        if (progress?.current_source_path) ctx.currentSourcePath = progress.current_source_path;
        ctx.phase = 'running';
        ctx.outcome = undefined;
        publishEmbedContext(plugin, ctx);
        // Throttle UI updates to max 1/sec
        const now = Date.now();
        if (now - lastProgressEmit > 1000) {
          lastProgressEmit = now;
          plugin.refreshStatus();
          emitEmbedProgress(plugin, ctx);
          updateEmbedNotice(plugin, ctx);
        }
      },
      on_save: async () => {
        await saveCollections(plugin);
        plugin.block_collection?.recomputeEmbeddedCount();
        plugin.source_collection?.recomputeEmbeddedCount();
        if (plugin.current_embed_context?.runId === runId) {
          ctx.saveCount += 1;
          publishEmbedContext(plugin, ctx);
        }
      },
      save_interval: effectiveSaveInterval,
    });

    if (plugin.current_embed_context?.runId !== runId) {
      plugin.setEmbedPhase('idle');
      plugin.current_embed_context = null;
      return stats;
    }

    ctx.current = stats.success + stats.failed + stats.skipped;
    ctx.total = stats.total;
    ctx.outcome = stats.outcome;
    ctx.error = stats.error ?? null;

    if (stats.outcome === 'failed') {
      ctx.phase = 'failed';
      publishEmbedContext(plugin, ctx);
      plugin.setEmbedPhase('error', { error: stats.error ?? 'Embedding pipeline failed' });
      plugin.logEmbed('run-failed', {
        runId: ctx.runId,
        adapter: ctx.adapter,
        modelKey: ctx.modelKey,
        dims: ctx.dims,
        current: ctx.current,
        total: ctx.total,
        currentSourcePath: ctx.currentSourcePath,
        error: stats.error ?? 'Embedding pipeline failed',
      });
      plugin.notices.show('embedding_failed');
      return stats;
    }

    if (stats.outcome === 'completed') {
      await saveCollections(plugin);
      plugin.block_collection?.recomputeEmbeddedCount();
      plugin.source_collection?.recomputeEmbeddedCount();
      ctx.saveCount += 1;
    }

    unresolvedAfterRun = plugin.queueUnembeddedEntities();
    ctx.followupQueued = unresolvedAfterRun > 0 && stats.outcome === 'completed' && !plugin._unloading;

    if (stats.outcome === 'halted') {
      ctx.phase = 'halted';
    } else if (ctx.followupQueued) {
      ctx.phase = 'followup-required';
    } else {
      ctx.phase = 'completed';
    }

    publishEmbedContext(plugin, ctx);
    plugin.setEmbedPhase('idle');
    if (!ctx.followupQueued) {
      plugin.current_embed_context = null;
    }

    if (stats.outcome === 'completed' && !ctx.followupQueued) {
      plugin.notices.show('embedding_complete', { success: stats.success });
    }

    if (unresolvedAfterRun > 0) {
      plugin.logEmbed('run-stale-remaining', {
        runId: ctx.runId,
        adapter: ctx.adapter,
        modelKey: ctx.modelKey,
        current: unresolvedAfterRun,
        total: unresolvedAfterRun,
      });
    }

    if (ctx.followupQueued) {
      scheduleFollowupRun(plugin, `${reason} (follow-up)`, runId);
    }

    plugin.logEmbed('run-finished', {
      runId,
      current: ctx.current,
      total: ctx.total,
      adapter: ctx.adapter,
      modelKey: ctx.modelKey,
      dims: ctx.dims,
      currentSourcePath: ctx.currentSourcePath,
    });

    return stats;
  } catch (error) {
    if (plugin.current_embed_context?.runId !== runId) {
      plugin.setEmbedPhase('idle');
      plugin.current_embed_context = null;
      throw error;
    }

    ctx.phase = 'failed';
    ctx.outcome = 'failed';
    ctx.error = errorMessage(error);
    publishEmbedContext(plugin, ctx);
    plugin.setEmbedPhase('error', { error: errorMessage(error) });
    plugin.logEmbed('run-failed', {
      runId: ctx.runId,
      adapter: ctx.adapter,
      modelKey: ctx.modelKey,
      dims: ctx.dims,
      current: ctx.current,
      total: ctx.total,
      currentSourcePath: ctx.currentSourcePath,
      error: errorMessage(error),
    });
    plugin.notices.show('embedding_failed');
    throw error;
  } finally {
    if (plugin.current_embed_context?.runId === runId || plugin.current_embed_context === null) {
      emitEmbedProgress(plugin, ctx, { done: true });
      publishEmbedContext(plugin, ctx);
      clearEmbedNotice(plugin);
    }
  }
}
