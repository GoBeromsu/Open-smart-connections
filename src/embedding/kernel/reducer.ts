/**
 * @file embedding/kernel/reducer.ts
 * @description Pure reducer for embedding kernel state transitions
 */

import type {
  EmbeddingKernelEvent,
  EmbeddingKernelState,
} from './types';

export function createInitialKernelState(): EmbeddingKernelState {
  return {
    phase: 'booting',
    model: null,
    run: null,
    queue: {
      pendingJobs: 0,
      staleTotal: 0,
      staleEmbeddableTotal: 0,
      queuedTotal: 0,
    },
    flags: {
      stopRequested: false,
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
      return {
        ...prev,
        phase: prev.phase === 'booting' ? 'idle' : prev.phase,
      };

    case 'MODEL_SWITCH_REQUESTED':
      return {
        ...prev,
        phase: 'loading_model',
        flags: { ...prev.flags, stopRequested: false },
        lastError: null,
      };

    case 'MODEL_SWITCH_SUCCEEDED':
      return {
        ...prev,
        phase: 'idle',
        model: event.model,
        run: null,
        flags: { ...prev.flags, stopRequested: false },
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

    case 'RUN_REQUESTED':
      return {
        ...prev,
        lastError: null,
      };

    case 'RUN_STARTED':
      return {
        ...prev,
        phase: 'running',
        run: event.run,
        flags: { ...prev.flags, stopRequested: false },
        lastError: null,
      };

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
        phase: prev.flags.stopRequested ? 'paused' : 'idle',
        run: null,
        flags: {
          ...prev.flags,
          stopRequested: false,
        },
      };

    case 'RUN_FAILED':
      return {
        ...prev,
        phase: prev.flags.stopRequested ? 'paused' : 'error',
        run: null,
        lastError: prev.flags.stopRequested
          ? prev.lastError
          : {
            code: 'RUN_FAILED',
            message: event.error,
            at: Date.now(),
          },
      };

    case 'STOP_REQUESTED':
      return {
        ...prev,
        phase: prev.phase === 'running' ? 'stopping' : prev.phase,
        flags: { ...prev.flags, stopRequested: true },
      };

    case 'STOP_COMPLETED':
      return {
        ...prev,
        phase: 'paused',
        run: null,
        flags: {
          ...prev.flags,
          stopRequested: false,
        },
      };

    case 'STOP_TIMEOUT':
      return {
        ...prev,
        phase: 'error',
        run: null,
        lastError: {
          code: 'STOP_TIMEOUT',
          message: 'Stopping embedding run timed out.',
          at: Date.now(),
        },
      };

    case 'RESUME_REQUESTED':
      return {
        ...prev,
        phase: prev.phase === 'paused' ? 'idle' : prev.phase,
        flags: { ...prev.flags, stopRequested: false },
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

    case 'SET_PHASE':
      return {
        ...prev,
        phase: event.phase,
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
