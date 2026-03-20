/**
 * @file embedding/kernel/reducer.ts
 * @description Pure reducer for embedding kernel state transitions (3-state: idle/running/error)
 */

import type {
  EmbeddingKernelEvent,
  EmbeddingKernelPhase,
  EmbeddingKernelState,
} from './types';

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

    case 'RETRY_SUCCESS':
      if (prev.phase !== 'error') return prev;
      return {
        ...prev,
        phase: 'running',
        lastError: null,
      };

    case 'MANUAL_RETRY':
      if (prev.phase !== 'error') return prev;
      return {
        ...prev,
        phase: 'running',
        lastError: null,
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

    case 'SET_PHASE': {
      const validSetPhaseTransitions: Record<string, EmbeddingKernelPhase[]> = {
        idle: ['error'],
        running: ['error'],
        error: ['idle'],
      };
      const allowed = validSetPhaseTransitions[prev.phase] ?? [];
      if (!allowed.includes(event.phase)) {
        console.warn(`[SC][FSM] SET_PHASE blocked: ${prev.phase} -> ${event.phase}`);
        return prev;
      }
      return {
        ...prev,
        phase: event.phase,
      };
    }

    case 'RESET_ERROR':
      return {
        ...prev,
        lastError: null,
      };

    default:
      return prev;
  }
}
