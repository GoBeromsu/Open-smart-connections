/**
 * @file embedding/kernel/types.ts
 * @description Core kernel state, event, and job types for embedding orchestration
 */

export type EmbeddingKernelPhase =
  | 'booting'
  | 'loading_model'
  | 'idle'
  | 'running'
  | 'stopping'
  | 'paused'
  | 'error';

export interface EmbeddingKernelModel {
  adapter: string;
  modelKey: string;
  host: string;
  dims: number | null;
  fingerprint: string;
}

export interface EmbeddingKernelRun {
  runId: number;
  reason: string;
  current: number;
  total: number;
  sourceTotal: number;
  blockTotal: number;
  startedAt: number;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
}

export interface EmbeddingKernelQueueSnapshot {
  pendingJobs: number;
  staleTotal: number;
  staleEmbeddableTotal: number;
  queuedTotal: number;
}

export interface EmbeddingKernelError {
  code: string;
  message: string;
  at: number;
  context?: string;
}

export interface EmbeddingKernelState {
  phase: EmbeddingKernelPhase;
  model: EmbeddingKernelModel | null;
  run: EmbeddingKernelRun | null;
  queue: EmbeddingKernelQueueSnapshot;
  flags: {
    stopRequested: boolean;
  };
  lastError: EmbeddingKernelError | null;
}

export type EmbeddingKernelEvent =
  | { type: 'INIT_CORE_READY' }
  | { type: 'INIT_CORE_FAILED'; error: string }
  | { type: 'MODEL_SWITCH_REQUESTED'; reason: string }
  | { type: 'MODEL_SWITCH_SUCCEEDED'; model: EmbeddingKernelModel }
  | { type: 'MODEL_SWITCH_FAILED'; reason: string; error: string }
  | { type: 'QUEUE_SNAPSHOT_UPDATED'; queue: EmbeddingKernelQueueSnapshot }
  | { type: 'RUN_REQUESTED'; reason: string }
  | { type: 'RUN_STARTED'; run: EmbeddingKernelRun }
  | {
    type: 'RUN_PROGRESS';
    current: number;
    total: number;
    currentEntityKey?: string | null;
    currentSourcePath?: string | null;
  }
  | { type: 'RUN_FINISHED' }
  | { type: 'RUN_FAILED'; error: string }
  | { type: 'STOP_REQUESTED'; reason: string }
  | { type: 'STOP_COMPLETED' }
  | { type: 'STOP_TIMEOUT' }
  | { type: 'RESUME_REQUESTED'; reason: string }
  | { type: 'REFRESH_REQUESTED'; reason: string }
  | { type: 'REIMPORT_REQUESTED'; reason: string }
  | { type: 'REIMPORT_COMPLETED' }
  | { type: 'REIMPORT_FAILED'; error: string }
  | { type: 'SET_PHASE'; phase: EmbeddingKernelPhase }
  | { type: 'RESET_ERROR' };

export type EmbeddingKernelJobType =
  | 'MODEL_SWITCH'
  | 'SYNC_QUEUE_SNAPSHOT'
  | 'QUEUE_STALE_ENTITIES'
  | 'RUN_EMBED_BATCH'
  | 'REIMPORT_SOURCES'
  | 'STOP_RUN'
  | 'RESUME_RUN'
  | 'REFRESH_REQUEST';

export interface EmbeddingKernelJob<T = unknown> {
  type: EmbeddingKernelJobType;
  key: string;
  priority: number;
  payload?: unknown;
  run: () => Promise<T>;
}

export type EmbeddingKernelListener = (
  state: EmbeddingKernelState,
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
) => void;

export interface EnqueuedKernelJob<T = unknown> {
  key: string;
  promise: Promise<T>;
}
