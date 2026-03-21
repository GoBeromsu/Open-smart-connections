/**
 * @file embedding/kernel/index.ts
 * @description Embedding kernel: reducer, selectors, effects, store, and job queue
 */

import type {
  EmbeddingKernelEvent,
  EmbeddingKernelJob,
  EmbeddingKernelListener,
  EmbeddingKernelState,
} from './types';

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function createInitialKernelState(): EmbeddingKernelState {
  return {
    phase: 'idle',
    model: null,
    run: null,
    queue: {
      pendingJobs: 0,
      staleTotal: 0,
      staleEmbeddableTotal: 0,
      queuedTotal: 0,
    },
    lastError: null,
  };
}

export function reduceEmbeddingKernelState(
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
): EmbeddingKernelState {
  switch (event.type) {
    case 'INIT_CORE_READY':
      return prev;

    case 'INIT_CORE_FAILED':
      return {
        ...prev,
        phase: 'error',
        lastError: {
          code: 'INIT_CORE_FAILED',
          message: event.error,
          at: Date.now(),
        },
      };

    case 'MODEL_SWITCH_REQUESTED':
      return {
        ...prev,
        phase: prev.phase === 'error' ? 'idle' : prev.phase,
        lastError: null,
      };

    case 'MODEL_SWITCH_SUCCEEDED':
      return {
        ...prev,
        phase: 'idle',
        model: event.model,
        run: null,
        lastError: null,
      };

    case 'MODEL_SWITCH_FAILED':
      return {
        ...prev,
        phase: 'error',
        run: null,
        lastError: {
          code: 'MODEL_SWITCH_FAILED',
          message: event.error,
          context: event.reason,
          at: Date.now(),
        },
      };

    case 'QUEUE_SNAPSHOT_UPDATED':
      return {
        ...prev,
        queue: event.queue,
      };

    case 'QUEUE_HAS_ITEMS':
      if (prev.phase !== 'idle') return prev;
      return {
        ...prev,
        phase: 'running',
      };

    case 'QUEUE_EMPTY':
      if (prev.phase !== 'running') return prev;
      return {
        ...prev,
        phase: 'idle',
        run: null,
      };

    case 'RUN_REQUESTED':
      return {
        ...prev,
        lastError: null,
      };

    case 'RUN_STARTED': {
      if (prev.phase !== 'idle') {
        console.warn(`[SC][FSM] RUN_STARTED blocked: cannot start from '${prev.phase}'`);
        return prev;
      }
      return {
        ...prev,
        phase: 'running',
        run: event.run,
        lastError: null,
      };
    }

    case 'RUN_PROGRESS':
      if (!prev.run) return prev;
      return {
        ...prev,
        run: {
          ...prev.run,
          current: event.current,
          total: event.total,
          currentEntityKey:
            event.currentEntityKey === undefined
              ? prev.run.currentEntityKey
              : event.currentEntityKey,
          currentSourcePath:
            event.currentSourcePath === undefined
              ? prev.run.currentSourcePath
              : event.currentSourcePath,
        },
      };

    case 'RUN_FINISHED':
      return {
        ...prev,
        phase: 'idle',
        run: null,
      };

    case 'RUN_FAILED':
      return {
        ...prev,
        phase: 'error',
        run: null,
        lastError: {
          code: 'RUN_FAILED',
          message: event.error,
          at: Date.now(),
        },
      };

    case 'FATAL_ERROR':
      if (prev.phase !== 'running') return prev;
      return {
        ...prev,
        phase: 'error',
        run: null,
        lastError: {
          code: event.code,
          message: event.error,
          at: Date.now(),
        },
      };

    case 'REFRESH_REQUESTED':
    case 'REIMPORT_REQUESTED':
      return {
        ...prev,
        lastError: null,
      };

    case 'REIMPORT_COMPLETED':
      return prev;

    case 'REIMPORT_FAILED':
      return {
        ...prev,
        lastError: {
          code: 'REIMPORT_FAILED',
          message: event.error,
          at: Date.now(),
        },
      };

    case 'RESET_ERROR':
      return {
        ...prev,
        lastError: null,
      };

    default:
      return prev;
  }
}

// ─── Selectors ───────────────────────────────────────────────────────────────

/** Lightweight status for UI consumers (status bar, settings) */
export type EmbedStatusState = 'idle' | 'embedding' | 'error';

export function toLegacyStatusState(state: EmbeddingKernelState): EmbedStatusState {
  switch (state.phase) {
    case 'running':
      return 'embedding';
    default:
      return state.phase;
  }
}

export function isEmbedReady(state: EmbeddingKernelState): boolean {
  if (!state.model) return false;
  return state.phase !== 'error';
}

// ─── Effects ─────────────────────────────────────────────────────────────────

export function buildKernelModel(
  adapter: string,
  modelKey: string,
  host: string,
  dims: number | null,
): {
  adapter: string;
  modelKey: string;
  host: string;
  dims: number | null;
  fingerprint: string;
} {
  const normalizedAdapter = (adapter || '').trim().toLowerCase();
  const normalizedModel = (modelKey || '').trim().toLowerCase();
  const normalizedHost = (host || '').trim().toLowerCase();
  return {
    adapter: normalizedAdapter,
    modelKey: normalizedModel,
    host: normalizedHost,
    dims,
    fingerprint: `${normalizedAdapter}|${normalizedModel}|${normalizedHost}`,
  };
}

/** Skip noisy events that fire on every batch progress tick */
const SILENT_EVENTS = new Set(['RUN_PROGRESS', 'QUEUE_SNAPSHOT_UPDATED']);

export function logKernelTransition(
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
  next: EmbeddingKernelState,
): void {
  if (SILENT_EVENTS.has(event.type)) return;
  if (prev.phase === next.phase && !('error' in event) && !('reason' in event)) return;

  const reason = 'reason' in event ? String((event as Record<string, unknown>).reason ?? '') : '';
  const error = 'error' in event ? String((event as Record<string, unknown>).error ?? '') : '';
  const parts: string[] = ['[Open Connections]'];

  if (prev.phase !== next.phase) {
    parts.push(`${prev.phase} → ${next.phase}`);
  } else {
    parts.push(event.type);
  }

  if (reason) parts.push(`(${reason})`);
  if (error) parts.push(`error: ${error}`);

  const run = next.run;
  if (run) parts.push(`${run.current}/${run.total}`);

  console.log(parts.join(' '));
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class EmbeddingKernelStore {
  private state: EmbeddingKernelState;
  private listeners: Set<EmbeddingKernelListener> = new Set();

  constructor(initialState?: EmbeddingKernelState) {
    this.state = initialState ?? createInitialKernelState();
  }

  getState(): EmbeddingKernelState {
    return this.state;
  }

  dispatch(event: EmbeddingKernelEvent): EmbeddingKernelState {
    const prev = this.state;
    const next = reduceEmbeddingKernelState(prev, event);
    this.state = next;

    for (const listener of this.listeners) {
      listener(next, prev, event);
    }

    return next;
  }

  subscribe(listener: EmbeddingKernelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ─── Job Queue ───────────────────────────────────────────────────────────────

interface PendingJob<T = unknown> {
  job: EmbeddingKernelJob<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  promise: Promise<T>;
}

export class EmbeddingKernelJobQueue {
  private pending: PendingJob[] = [];
  private indexed: Map<string, PendingJob> = new Map();
  private inflight: Map<string, Promise<unknown>> = new Map();
  private running = false;
  private scheduled = false;

  enqueue<T>(job: EmbeddingKernelJob<T>): Promise<T> {
    const inflight = this.inflight.get(job.key) as Promise<T> | undefined;
    if (inflight) return inflight;

    const existing = this.indexed.get(job.key) as PendingJob<T> | undefined;
    if (existing) return existing.promise;

    let resolveFn!: (value: T) => void;
    let rejectFn!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const pending: PendingJob<T> = {
      job,
      resolve: resolveFn,
      reject: rejectFn,
      promise,
    };

    this.pending.push(pending as PendingJob);
    this.indexed.set(job.key, pending as PendingJob);
    this.inflight.set(job.key, pending.promise);
    this.pending.sort((a, b) => a.job.priority - b.job.priority);
    this.scheduleProcess();

    return promise;
  }

  size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  clear(reason: string = 'Queue cleared'): void {
    const rest = [...this.pending];
    this.pending = [];
    this.indexed.clear();
    for (const pending of rest) {
      pending.reject(new Error(reason));
    }
    this.inflight.clear();
  }

  private scheduleProcess(): void {
    if (this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.process().catch((error) => {
        console.error('Kernel job queue processing failed:', error);
      });
    });
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (!next) continue;
        this.indexed.delete(next.job.key);

        try {
          const result = await next.job.run();
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        } finally {
          // Only delete inflight if it still points to this job's promise.
          // After clear(), a new job with the same key may have been enqueued.
          if (this.inflight.get(next.job.key) === next.promise) {
            this.inflight.delete(next.job.key);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
