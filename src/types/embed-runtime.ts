/**
 * @file embed-runtime.ts
 * @description Shared runtime and event payload types for embedding state.
 */

export type EmbedRunOutcome = 'completed' | 'halted' | 'failed';

export type EmbedRunPhase =
  | 'running'
  | 'completed'
  | 'halted'
  | 'failed'
  | 'followup-required';

export type EmbedStatePhase = 'idle' | 'running' | 'error';

export type EmbedProfilingStageName =
  | 'init:core'
  | 'init:embedding'
  | 'init:background-import'
  | 'reconcile:excluded-folders'
  | 'discovery:process-new-sources'
  | 'embedding:run'
  | 'embedding:save'
  | 'embedding:followup-schedule'
  | 'ui:connections-view:render';

export interface EmbedStageMeasurement {
  name: EmbedProfilingStageName;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface EmbedProfilingCounters {
  saveCount: number;
  followupScheduledCount: number;
  progressEventCount: number;
  connectionsViewRenderCount: number;
}

export interface EmbedProfilingState {
  activeStage: EmbedProfilingStageName | null;
  activeSince: number | null;
  recentStages: EmbedStageMeasurement[];
  counters: EmbedProfilingCounters;
}

export interface EmbeddingRunContext {
  runId: number;
  phase: EmbedRunPhase;
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  startedAt: number;
  current: number;
  total: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  followupQueued?: boolean;
  error?: string | null;
}

export interface EmbedProgressEventPayload {
  runId: number;
  phase: EmbeddingRunContext['phase'];
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  current: number;
  total: number;
  percent: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  startedAt: number;
  elapsedMs: number;
  followupQueued?: boolean;
  done?: boolean;
  error?: string;
}

export interface EmbedStateSnapshot {
  phase: EmbedStatePhase;
  modelFingerprint: string | null;
  lastError: string | null;
}

export interface EmbedStateChangePayload {
  phase: EmbedStatePhase;
  prev: EmbedStatePhase;
}

export type EmbedModelState =
  | { kind: 'warming_up' }
  | { kind: 'ready'; fingerprint: string }
  | { kind: 'unavailable'; error: string | null };

export type EmbedBackfillState =
  | { kind: 'idle' }
  | { kind: 'running'; context: EmbeddingRunContext | null }
  | { kind: 'failed'; error: string | null };

export type EmbedServingState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'degraded'; reason: 'backfill_failed'; error: string | null }
  | { kind: 'unavailable'; reason: 'model_unavailable'; error: string | null };

export interface ParsedEmbedRuntimeState {
  snapshot: EmbedStateSnapshot;
  model: EmbedModelState;
  backfill: EmbedBackfillState;
  serving: EmbedServingState;
  profiling: EmbedProfilingState;
}

const EMPTY_PROFILING: EmbedProfilingState = {
  activeStage: null,
  activeSince: null,
  recentStages: [],
  counters: {
    saveCount: 0,
    followupScheduledCount: 0,
    progressEventCount: 0,
    connectionsViewRenderCount: 0,
  },
};

export function parseEmbedRuntimeState(
  snapshot: EmbedStateSnapshot,
  currentContext: EmbeddingRunContext | null = null,
  profiling: EmbedProfilingState = EMPTY_PROFILING,
): ParsedEmbedRuntimeState {
  const model: EmbedModelState = snapshot.modelFingerprint
    ? { kind: 'ready', fingerprint: snapshot.modelFingerprint }
    : snapshot.phase === 'error'
      ? { kind: 'unavailable', error: snapshot.lastError }
      : { kind: 'warming_up' };

  const backfill: EmbedBackfillState = snapshot.phase === 'running'
    ? { kind: 'running', context: currentContext }
    : snapshot.phase === 'error'
      ? { kind: 'failed', error: snapshot.lastError }
      : { kind: 'idle' };

  const serving: EmbedServingState = snapshot.modelFingerprint === null
    ? snapshot.phase === 'error'
      ? { kind: 'unavailable', reason: 'model_unavailable', error: snapshot.lastError }
      : { kind: 'loading' }
    : snapshot.phase === 'error'
      ? { kind: 'degraded', reason: 'backfill_failed', error: snapshot.lastError }
      : { kind: 'ready' };

  return {
    snapshot,
    model,
    backfill,
    serving,
    profiling,
  };
}

export function toLegacyStatusState(
  runtime: ParsedEmbedRuntimeState,
): 'idle' | 'embedding' | 'error' {
  if (runtime.backfill.kind === 'running') return 'embedding';
  if (runtime.serving.kind === 'degraded' || runtime.serving.kind === 'unavailable') return 'error';
  return 'idle';
}

export function isEmbedModelReady(runtime: ParsedEmbedRuntimeState): boolean {
  return runtime.model.kind === 'ready' && runtime.backfill.kind !== 'failed';
}
