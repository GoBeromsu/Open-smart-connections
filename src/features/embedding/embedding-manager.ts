/**
 * @file embedding/embedding-manager.ts
 * @description Embedding model initialization, pipeline management, run orchestration, notices, and progress events
 */

import type SmartConnectionsPlugin from '../../app/main';
import type { EmbeddingRunContext, EmbedProgressEventPayload } from '../../app/main';
import { CONNECTIONS_VIEW_TYPE } from '../connections/ConnectionsView';

import { EmbedModel } from '../../shared/models/embed';
import { TransformersEmbedAdapter, TRANSFORMERS_EMBED_MODELS } from '../../shared/models/embed/adapters/transformers';
import { OpenAIEmbedAdapter, OPENAI_EMBED_MODELS } from '../../shared/models/embed/adapters/openai';
import { OllamaEmbedAdapter } from '../../shared/models/embed/adapters/ollama';
import { GeminiEmbedAdapter, GEMINI_EMBED_MODELS } from '../../shared/models/embed/adapters/gemini';
import { LmStudioEmbedAdapter } from '../../shared/models/embed/adapters/lm_studio';
import { UpstageEmbedAdapter, UPSTAGE_EMBED_MODELS } from '../../shared/models/embed/adapters/upstage';
import { OpenRouterEmbedAdapter } from '../../shared/models/embed/adapters/open_router';

import {
  EmbeddingPipeline,
  type EmbedQueueStats,
} from '../../shared/search/embedding-pipeline';
import {
  getEmbeddingQueueSnapshot,
} from './collection-manager';
import { buildKernelModel } from './kernel/effects';
import type { EmbeddingKernelJobType } from './kernel/types';

// ── Model info helpers ──────────────────────────────────────────────

export function getCurrentModelInfo(plugin: SmartConnectionsPlugin): { adapter: string; modelKey: string; dims: number | null } {
  const adapter = plugin.embed_model?.adapter?.adapter
    ?? plugin.settings?.smart_sources?.embed_model?.adapter
    ?? 'unknown';
  const modelKey = plugin.embed_model?.model_key
    ?? plugin.getEmbedAdapterSettings(plugin.settings?.smart_sources?.embed_model as any)?.model_key
    ?? 'unknown';
  const dims = plugin.embed_model?.adapter?.dims ?? null;
  return { adapter, modelKey, dims };
}

export function getActiveEmbeddingContext(plugin: SmartConnectionsPlugin): EmbeddingRunContext | null {
  if (!plugin.current_embed_context) return null;
  return { ...plugin.current_embed_context };
}

function dispatchQueueSnapshot(plugin: SmartConnectionsPlugin): void {
  plugin.dispatchKernelEvent({
    type: 'QUEUE_SNAPSHOT_UPDATED',
    queue: getEmbeddingQueueSnapshot(plugin),
  });
}

function enqueueKernelJob<T>(
  plugin: SmartConnectionsPlugin,
  type: EmbeddingKernelJobType,
  key: string,
  priority: number,
  run: () => Promise<T>,
): Promise<T> {
  return plugin.enqueueEmbeddingJob<T>({
    type,
    key,
    priority,
    run,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
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

  const runId = context.runId ?? plugin.active_embed_run_id ?? '-';
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
  console.log(`[SC][Embed] ${event} run=${runId}${progress}${model}${note}${reason}${error}`);
}

// ── Notice helpers ──────────────────────────────────────────────────

export function buildEmbedNoticeMessage(ctx: EmbeddingRunContext): string {
  const percent = ctx.total > 0 ? Math.round((ctx.current / ctx.total) * 100) : 0;
  return `Smart Connections: ${ctx.adapter}/${ctx.modelKey} ${ctx.current}/${ctx.total} (${percent}%)`;
}

export function clearEmbedNotice(plugin: SmartConnectionsPlugin): void {
  plugin.notices.remove('embedding_progress');
  plugin.embed_notice_last_update = 0;
  plugin.embed_notice_last_percent = 0;
}

export function updateEmbedNotice(plugin: SmartConnectionsPlugin, ctx: EmbeddingRunContext, force: boolean = false): void {
  const hasConnectionsViewOpen =
    plugin.app.workspace.getLeavesOfType(CONNECTIONS_VIEW_TYPE).length > 0;
  if (hasConnectionsViewOpen) {
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
  const etaMs =
    ctx.current > 0 && ctx.total > ctx.current
      ? Math.round((elapsedMs / ctx.current) * (ctx.total - ctx.current))
      : null;

  const payload: EmbedProgressEventPayload = {
    runId: ctx.runId,
    phase: ctx.phase,
    reason: ctx.reason,
    adapter: ctx.adapter,
    modelKey: ctx.modelKey,
    dims: ctx.dims,
    currentEntityKey: ctx.currentEntityKey,
    currentSourcePath: ctx.currentSourcePath,
    current: ctx.current,
    total: ctx.total,
    percent,
    sourceTotal: ctx.sourceTotal,
    blockTotal: ctx.blockTotal,
    saveCount: ctx.saveCount,
    sourceDataDir: ctx.sourceDataDir,
    blockDataDir: ctx.blockDataDir,
    startedAt: ctx.startedAt,
    elapsedMs,
    etaMs,
    done: opts.done,
    error: opts.error,
  };

  plugin.app.workspace.trigger('smart-connections:embed-progress' as any, payload);
}

// ── Model initialization ────────────────────────────────────────────

export async function initEmbedModel(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const embedSettings = plugin.settings.smart_sources.embed_model;
    const adapterType = embedSettings.adapter;

    const adapterSettings = plugin.getEmbedAdapterSettings(embedSettings);
    const modelKey = adapterSettings.model_key || '';

    let adapter: any;

    switch (adapterType) {
      case 'transformers': {
        const modelInfo = TRANSFORMERS_EMBED_MODELS[modelKey];
        if (!modelInfo) throw new Error(`Unknown transformers model: ${modelKey}`);
        console.log(`[SC][Init]   [model] Creating transformers adapter for ${modelKey} (dims=${modelInfo.dims ?? 384})`);
        adapter = new TransformersEmbedAdapter({
          adapter: 'transformers',
          model_key: modelKey,
          dims: modelInfo.dims ?? 384,
          models: TRANSFORMERS_EMBED_MODELS,
          settings: adapterSettings,
        });
        const tLoad = performance.now();
        console.log('[SC][Init]   [model] Loading adapter (this may download model files)...');
        await adapter.load();
        console.log(`[SC][Init]   [model] Adapter loaded ✓ (${(performance.now() - tLoad).toFixed(0)}ms)`);
        break;
      }
      case 'openai': {
        const modelInfo = OPENAI_EMBED_MODELS[modelKey];
        if (!modelInfo) throw new Error(`Unknown OpenAI model: ${modelKey}`);
        console.log(`[SC][Init]   [model] Creating openai adapter for ${modelKey} (dims=${modelInfo.dims ?? 1536})`);
        adapter = new OpenAIEmbedAdapter({
          adapter: 'openai',
          model_key: modelKey,
          dims: modelInfo.dims ?? 1536,
          models: OPENAI_EMBED_MODELS,
          settings: adapterSettings,
        });
        break;
      }
      case 'ollama': {
        console.log(`[SC][Init]   [model] Creating ollama adapter for ${modelKey} (dims=${adapterSettings.dims || 384})`);
        adapter = new OllamaEmbedAdapter({
          adapter: 'ollama',
          model_key: modelKey,
          dims: adapterSettings.dims || 384,
          models: {},
          settings: adapterSettings,
        });
        break;
      }
      case 'gemini': {
        const modelInfo = GEMINI_EMBED_MODELS[modelKey];
        if (!modelInfo) throw new Error(`Unknown Gemini model: ${modelKey}`);
        console.log(`[SC][Init]   [model] Creating gemini adapter for ${modelKey} (dims=${modelInfo.dims ?? 768})`);
        adapter = new GeminiEmbedAdapter({
          adapter: 'gemini',
          model_key: modelKey,
          dims: modelInfo.dims ?? 768,
          models: GEMINI_EMBED_MODELS,
          settings: adapterSettings,
        });
        break;
      }
      case 'lm_studio': {
        console.log(`[SC][Init]   [model] Creating lm_studio adapter for ${modelKey} (dims=${adapterSettings.dims || 384})`);
        adapter = new LmStudioEmbedAdapter({
          adapter: 'lm_studio',
          model_key: modelKey,
          dims: adapterSettings.dims || 384,
          models: {},
          settings: adapterSettings,
        });
        break;
      }
      case 'upstage': {
        const modelInfo = UPSTAGE_EMBED_MODELS[modelKey];
        if (!modelInfo) throw new Error(`Unknown Upstage model: ${modelKey}`);
        console.log(`[SC][Init]   [model] Creating upstage adapter for ${modelKey} (dims=${modelInfo.dims ?? 4096})`);
        adapter = new UpstageEmbedAdapter({
          adapter: 'upstage',
          model_key: modelKey,
          dims: modelInfo.dims ?? 4096,
          models: UPSTAGE_EMBED_MODELS,
          settings: adapterSettings,
        });
        break;
      }
      case 'open_router': {
        console.log(`[SC][Init]   [model] Creating open_router adapter for ${modelKey} (dims=${adapterSettings.dims || 1536})`);
        adapter = new OpenRouterEmbedAdapter({
          adapter: 'open_router',
          model_key: modelKey,
          dims: adapterSettings.dims || 1536,
          models: {},
          settings: adapterSettings,
        });
        break;
      }
      default:
        throw new Error(`Unknown embed adapter: ${adapterType}`);
    }

    plugin.embed_model = new EmbedModel({
      adapter,
      model_key: modelKey,
      settings: plugin.settings,
    });

    console.log(`[SC][Init]   [model] Embed model initialized ✓ (${adapterType}/${modelKey})`);
  } catch (error) {
    console.error('[SC][Init]   [model] Failed to initialize embed model:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (
      plugin.settings.smart_sources.embed_model.adapter === 'transformers' &&
      /(failed to fetch|network|cdn|timed out)/i.test(message)
    ) {
      plugin.notices.show(
        'failed_download_transformers_model',
        { error: message },
        { timeout: 8000 },
      );
    }
    plugin.notices.show('failed_init_embed_model');
    throw error;
  }
}

// ── Pipeline initialization ─────────────────────────────────────────

export async function initPipeline(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    if (!plugin.embed_model) {
      throw new Error('Embed model must be initialized before pipeline');
    }

    console.log('Initializing embedding pipeline...');
    plugin.embedding_pipeline = new EmbeddingPipeline(plugin.embed_model.adapter);
    console.log('Embedding pipeline initialized successfully');
  } catch (error) {
    console.error('Failed to initialize pipeline:', error);
    plugin.notices.show('failed_init_embed_pipeline');
    throw error;
  }
}

// ── Re-embed stale entities ─────────────────────────────────────────

export async function reembedStaleEntities(plugin: SmartConnectionsPlugin, reason: string = 'Manual re-embed'): Promise<number> {
  return enqueueKernelJob(
    plugin,
    'REFRESH_REQUEST',
    'REFRESH_REQUEST',
    20,
    async () => reembedStaleEntitiesNow(plugin, reason),
  );
}

async function reembedStaleEntitiesNow(plugin: SmartConnectionsPlugin, reason: string = 'Manual re-embed'): Promise<number> {
  plugin.dispatchKernelEvent({ type: 'REFRESH_REQUESTED', reason });
  const queued = plugin.queueUnembeddedEntities();
  dispatchQueueSnapshot(plugin);
  if (queued === 0) {
    plugin.logEmbed('reembed-skip-empty', { reason });
    return 0;
  }
  await runEmbeddingJobNow(plugin, reason);
  return queued;
}

// ── Model switch ────────────────────────────────────────────────────

export async function switchEmbeddingModel(plugin: SmartConnectionsPlugin, reason: string = 'Embedding model switch'): Promise<void> {
  await enqueueKernelJob(
    plugin,
    'MODEL_SWITCH',
    'MODEL_SWITCH',
    5,
    async () => {
      await switchEmbeddingModelNow(plugin, reason);
    },
  );
}

async function haltActivePipelineForSwitch(
  plugin: SmartConnectionsPlugin,
  reason: string,
  previous: { adapter: string; modelKey: string; dims: number | null },
): Promise<void> {
  if (!plugin.embedding_pipeline?.is_active()) return;

  plugin.embedding_pipeline.halt();
  plugin.logEmbed('switch-halt-pipeline', {
    reason,
    adapter: previous.adapter,
    modelKey: previous.modelKey,
    dims: previous.dims,
  });
}

async function unloadPreviousModel(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.embed_model) return;
  try {
    await plugin.embed_model.unload();
  } catch (error) {
    console.warn('Failed to unload previous embed model during switch:', error);
  }
}

function getModelLoadTimeoutMs(plugin: SmartConnectionsPlugin): number {
  const targetAdapterSettings = plugin.getEmbedAdapterSettings(
    plugin.settings?.smart_sources?.embed_model as any,
  );
  const configuredLoadTimeoutMs = Number((targetAdapterSettings as any)?.request_timeout_ms);
  return Number.isFinite(configuredLoadTimeoutMs) && configuredLoadTimeoutMs > 0
    ? configuredLoadTimeoutMs
    : 180000;
}

function notifyModelSwitchSuccess(
  plugin: SmartConnectionsPlugin,
  reason: string,
  queuedAfterSync: number,
): void {
  const active = getCurrentModelInfo(plugin);
  const adapterSettings = plugin.getEmbedAdapterSettings(
    plugin.settings?.smart_sources?.embed_model as any,
  );
  plugin.dispatchKernelEvent({
    type: 'MODEL_SWITCH_SUCCEEDED',
    model: buildKernelModel(
      active.adapter,
      active.modelKey,
      String((adapterSettings as any)?.host || ''),
      active.dims,
    ),
  });
  plugin.app.workspace.trigger('smart-connections:embed-ready');
  plugin.app.workspace.trigger('smart-connections:model-switched' as any, {
    adapter: active.adapter,
    modelKey: active.modelKey,
    dims: active.dims,
    switchedAt: Date.now(),
  });
  plugin.logEmbed('switch-ready', {
    reason,
    adapter: active.adapter,
    modelKey: active.modelKey,
    dims: active.dims,
    current: queuedAfterSync,
    total: queuedAfterSync,
  });
}

async function switchEmbeddingModelNow(plugin: SmartConnectionsPlugin, reason: string = 'Embedding model switch'): Promise<void> {
  plugin.dispatchKernelEvent({ type: 'MODEL_SWITCH_REQUESTED', reason });
  const previous = getCurrentModelInfo(plugin);
  const previousModelKey = plugin.embed_model?.model_key ?? '';
  const targetAdapterSettings = plugin.getEmbedAdapterSettings(
    plugin.settings?.smart_sources?.embed_model as any,
  );
  const targetAdapter = plugin.settings?.smart_sources?.embed_model?.adapter ?? '';
  const targetModelKey = (targetAdapterSettings as any)?.model_key ?? '';
  const shouldForceReembed =
    !!plugin.embed_model && (previousModelKey !== targetModelKey || previous.adapter !== targetAdapter);
  plugin.logEmbed('switch-start', {
    reason,
    adapter: previous.adapter,
    modelKey: previous.modelKey,
    dims: previous.dims,
  });

  try {
    let t = performance.now();
    console.log('[SC][Init]   [switch] Halting active pipeline...');
    await haltActivePipelineForSwitch(plugin, reason, previous);
    console.log(`[SC][Init]   [switch] Pipeline halted ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    // Clear orchestration queue; entities will be re-scanned after the new model loads
    plugin.embed_job_queue?.clear();

    t = performance.now();
    console.log('[SC][Init]   [switch] Unloading previous model...');
    await unloadPreviousModel(plugin);
    console.log(`[SC][Init]   [switch] Previous model unloaded ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    const modelLoadTimeoutMs = getModelLoadTimeoutMs(plugin);
    t = performance.now();
    console.log(`[SC][Init]   [switch] Loading model: ${targetAdapter}/${targetModelKey} (timeout: ${(modelLoadTimeoutMs / 1000).toFixed(0)}s)...`);
    await withTimeout(
      plugin.initEmbedModel(),
      modelLoadTimeoutMs,
      `Timed out while loading embedding model (${targetAdapter}/${targetModelKey}).`,
    );
    console.log(`[SC][Init]   [switch] Model loaded ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    t = performance.now();
    console.log('[SC][Init]   [switch] Syncing collection embedding context...');
    plugin.syncCollectionEmbeddingContext();
    console.log(`[SC][Init]   [switch] Context synced ✓ (${(performance.now() - t).toFixed(0)}ms)`);

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
    console.log(`[SC][Init]   [switch] Queue: ${queuedAfterSync} entities need embedding`);
    dispatchQueueSnapshot(plugin);

    t = performance.now();
    console.log('[SC][Init]   [switch] Initializing pipeline...');
    await plugin.initPipeline();
    console.log(`[SC][Init]   [switch] Pipeline initialized ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    notifyModelSwitchSuccess(plugin, reason, queuedAfterSync);
    console.log('[SC][Init]   [switch] Model switch complete ✓');

    if (queuedAfterSync > 0) {
      void plugin.runEmbeddingJob(reason).catch((error) => {
        console.error('Background embedding failed after model switch:', error);
      });
    }
  } catch (error) {
    plugin.dispatchKernelEvent({
      type: 'MODEL_SWITCH_FAILED',
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    plugin.logEmbed('switch-failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ── Main embedding job ──────────────────────────────────────────────

export async function runEmbeddingJob(plugin: SmartConnectionsPlugin, reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> {
  return enqueueKernelJob(
    plugin,
    'RUN_EMBED_BATCH',
    'RUN_EMBED_BATCH',
    30,
    async () => runEmbeddingJobNow(plugin, reason),
  );
}

export async function runEmbeddingJobImmediate(plugin: SmartConnectionsPlugin, reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> {
  return runEmbeddingJobNow(plugin, reason);
}

function createProgressCallback(
  plugin: SmartConnectionsPlugin,
  runId: number,
  ctx: EmbeddingRunContext,
): (current: number, total: number, progress?: { current_key: string | null; current_source_path: string | null }) => void {
  return (current, total, progress) => {
    if (plugin.active_embed_run_id !== runId) return;
    ctx.current = current;
    ctx.total = total;
    if (progress?.current_key) {
      ctx.currentEntityKey = progress.current_key;
    }
    if (progress?.current_source_path) {
      ctx.currentSourcePath = progress.current_source_path;
    }
    ctx.phase = 'running';
    plugin.dispatchKernelEvent({
      type: 'RUN_PROGRESS',
      current: ctx.current,
      total: ctx.total,
      currentEntityKey: ctx.currentEntityKey,
      currentSourcePath: ctx.currentSourcePath,
    });
    emitEmbedProgress(plugin, ctx);
    updateEmbedNotice(plugin, ctx);
  };
}

function createSaveCallback(
  plugin: SmartConnectionsPlugin,
  runId: number,
  ctx: EmbeddingRunContext,
): () => Promise<void> {
  return async () => {
    if (!plugin.source_collection) return;
    await plugin.source_collection.data_adapter.save();
    if (plugin.block_collection) {
      await plugin.block_collection.data_adapter.save();
    }
    if (plugin.active_embed_run_id === runId) {
      ctx.saveCount += 1;
    }
  };
}

async function saveCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection) return;
  await plugin.source_collection.data_adapter.save();
  if (plugin.block_collection) {
    await plugin.block_collection.data_adapter.save();
  }
}

function handleRunCompleted(
  plugin: SmartConnectionsPlugin,
  ctx: EmbeddingRunContext,
  stats: EmbedQueueStats,
): number {
  ctx.phase = 'completed';
  plugin.dispatchKernelEvent({ type: 'RUN_FINISHED' });
  plugin.notices.show('embedding_complete', { success: stats.success });
  // Clear the orchestration queue before re-scanning; queueUnembeddedEntities
  // will re-populate it with any entities that still need embedding.
  plugin.embed_job_queue?.clear();
  const unresolvedAfterRun = plugin.queueUnembeddedEntities();
  dispatchQueueSnapshot(plugin);
  if (unresolvedAfterRun > 0) {
    plugin.logEmbed('run-stale-remaining', {
      runId: ctx.runId,
      adapter: ctx.adapter,
      modelKey: ctx.modelKey,
      current: unresolvedAfterRun,
      total: unresolvedAfterRun,
    });
  }
  return unresolvedAfterRun;
}

function handleRunFailed(
  plugin: SmartConnectionsPlugin,
  ctx: EmbeddingRunContext,
  error: unknown,
): void {
  ctx.phase = 'failed';
  plugin.dispatchKernelEvent({
    type: 'RUN_FAILED',
    error: error instanceof Error ? error.message : String(error),
  });
  plugin.logEmbed('run-failed', {
    runId: ctx.runId,
    adapter: ctx.adapter,
    modelKey: ctx.modelKey,
    dims: ctx.dims,
    current: ctx.current,
    total: ctx.total,
    currentSourcePath: ctx.currentSourcePath,
    error: error instanceof Error ? error.message : String(error),
  });
  plugin.notices.show('embedding_failed');
}

function scheduleStaleRetry(
  plugin: SmartConnectionsPlugin,
  reason: string,
  unresolvedAfterRun: number,
): void {
  const isRetryRun = reason.includes('[stale-retry]');
  if (isRetryRun || unresolvedAfterRun <= 0) return;

  // Retry once for entities that stayed stale after the first run.
  // This helps model-switch migrations converge without creating infinite loops.
  void enqueueKernelJob(
    plugin,
    'RUN_EMBED_BATCH',
    'RUN_EMBED_BATCH_RETRY',
    35,
    async () => runEmbeddingJobNow(plugin, `${reason} [stale-retry]`),
  ).catch((retryError) => {
    console.error('Failed stale-retry embedding run:', retryError);
  });
}

async function runEmbeddingJobNow(plugin: SmartConnectionsPlugin, reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> {
  // Phase guard: reject runs when kernel is in an error state
  const phase = plugin.getEmbeddingKernelState().phase;
  if (phase === 'error') {
    console.warn(`[SC] runEmbeddingJobNow rejected: kernel phase is '${phase}'`);
    return null;
  }

  // Reject runs after plugin unload
  if (plugin._unloading) {
    console.warn('[SC] runEmbeddingJobNow rejected: plugin is unloading');
    return null;
  }

  if (!plugin.source_collection || !plugin.embedding_pipeline) {
    dispatchQueueSnapshot(plugin);
    return null;
  }

  if (plugin.embedding_pipeline.is_active()) {
    plugin.logEmbed('run-skip-active', { reason });
    dispatchQueueSnapshot(plugin);
    return null;
  }

  // Collect entities to embed from the unified EmbedJobQueue.
  // The pipeline still reads _queue_embed internally, so we resolve entity objects
  // from the queue's entityKeys and filter for those with _queue_embed set.
  const jobKeys = plugin.embed_job_queue
    ? new Set(plugin.embed_job_queue.toArray().map(j => j.entityKey))
    : new Set<string>();
  const sourcesToEmbed = plugin.source_collection.all.filter(
    (s: any) => s._queue_embed && s.should_embed && jobKeys.has(s.key),
  );
  const blocksToEmbed = (plugin.block_collection?.all || []).filter(
    (b: any) => b._queue_embed && b.should_embed && jobKeys.has(b.key),
  );
  const entitiesToEmbed = [...sourcesToEmbed, ...blocksToEmbed];

  if (entitiesToEmbed.length === 0) {
    plugin.logEmbed('run-skip-empty', { reason });
    dispatchQueueSnapshot(plugin);
    return null;
  }

  const model = getCurrentModelInfo(plugin);
  const runId = ++plugin.embed_run_seq;
  const firstEntity = entitiesToEmbed[0];
  const ctx: EmbeddingRunContext = {
    runId,
    phase: 'running',
    reason,
    adapter: model.adapter,
    modelKey: model.modelKey,
    dims: model.dims,
    currentEntityKey: firstEntity?.key ?? null,
    currentSourcePath: firstEntity?.key?.split('#')[0] ?? null,
    startedAt: Date.now(),
    current: 0,
    total: entitiesToEmbed.length,
    sourceTotal: sourcesToEmbed.length,
    blockTotal: blocksToEmbed.length,
    saveCount: 0,
    sourceDataDir: plugin.source_collection.data_dir,
    blockDataDir: plugin.block_collection?.data_dir ?? '',
  };

  plugin.dispatchKernelEvent({ type: 'RUN_REQUESTED', reason });
  plugin.active_embed_run_id = runId;
  plugin.current_embed_context = ctx;
  plugin.dispatchKernelEvent({
    type: 'RUN_STARTED',
    run: {
      runId,
      reason,
      current: 0,
      total: ctx.total,
      sourceTotal: ctx.sourceTotal,
      blockTotal: ctx.blockTotal,
      startedAt: ctx.startedAt,
      currentEntityKey: ctx.currentEntityKey,
      currentSourcePath: ctx.currentSourcePath,
    },
  });
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
    sourceTotal: ctx.sourceTotal,
    blockTotal: ctx.blockTotal,
    sourceDataDir: ctx.sourceDataDir,
    blockDataDir: ctx.blockDataDir,
  });

  let unresolvedAfterRun = 0;

  try {
    const stats = await plugin.embedding_pipeline.process(entitiesToEmbed, {
      batch_size: 10,
      max_retries: 3,
      on_progress: createProgressCallback(plugin, runId, ctx),
      on_save: createSaveCallback(plugin, runId, ctx),
      save_interval: 50,
    });

    if (plugin.active_embed_run_id !== runId) {
      plugin.dispatchKernelEvent({ type: 'RUN_FINISHED' });
      return stats;
    }

    ctx.current = stats.success + stats.failed + stats.skipped;
    ctx.total = stats.total;

    await saveCollections(plugin);
    ctx.saveCount += 1;

    unresolvedAfterRun = handleRunCompleted(plugin, ctx, stats);

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
    if (plugin.active_embed_run_id !== runId) {
      plugin.dispatchKernelEvent({ type: 'RUN_FINISHED' });
      throw error;
    }
    handleRunFailed(plugin, ctx, error);
    throw error;
  } finally {
    if (plugin.active_embed_run_id === runId) {
      emitEmbedProgress(plugin, ctx, { done: true });
      plugin.current_embed_context = { ...ctx };
      plugin.active_embed_run_id = null;
      clearEmbedNotice(plugin);
      dispatchQueueSnapshot(plugin);
      scheduleStaleRetry(plugin, reason, unresolvedAfterRun);
    }
  }
}
