/**
 * @file embedding-kernel-reducer.test.ts
 * @description Transition table tests for the 3-state embedding kernel reducer
 *
 * Phase 1: 7-state FSM (booting/idle/loading_model/running/stopping/paused/error)
 *        -> 3-state FSM (idle/running/error)
 *
 * States:
 *   idle    - queue is empty or model is loading, no active embedding run
 *   running - embedding run is actively processing
 *   error   - fatal/unrecoverable error (e.g. API key expired). Transient errors (429/5xx) stay in running.
 *
 * Events (new):
 *   QUEUE_HAS_ITEMS  -> idle -> running
 *   QUEUE_EMPTY      -> running -> idle
 *   FATAL_ERROR      -> running -> error
 *   RETRY_SUCCESS    -> error -> running
 *   MANUAL_RETRY     -> error -> running
 *
 * Removed states: booting, loading_model, stopping, paused
 * Removed events: STOP_REQUESTED, STOP_COMPLETED, STOP_TIMEOUT, RESUME_REQUESTED
 */

import { describe, expect, it } from 'vitest';
import {
  createInitialKernelState,
  reduceEmbeddingKernelState,
} from '../src/features/embedding/kernel/reducer';

function step(state: ReturnType<typeof createInitialKernelState>, event: any) {
  return reduceEmbeddingKernelState(state, event);
}

describe('embedding kernel reducer (3-state FSM)', () => {
  // ── Initial state ──────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts in idle phase', () => {
      const initial = createInitialKernelState();
      expect(initial.phase).toBe('idle');
    });

    it('has no model, run, or error initially', () => {
      const initial = createInitialKernelState();
      expect(initial.model).toBeNull();
      expect(initial.run).toBeNull();
      expect(initial.lastError).toBeNull();
    });
  });

  // ── idle -> running transitions ────────────────────────────────────────
  describe('idle -> running', () => {
    it('transitions from idle to running on QUEUE_HAS_ITEMS', () => {
      const initial = createInitialKernelState();
      expect(initial.phase).toBe('idle');

      const next = step(initial, { type: 'QUEUE_HAS_ITEMS' });
      expect(next.phase).toBe('running');
    });

    it('transitions from idle to running on RUN_STARTED', () => {
      const initial = createInitialKernelState();
      const next = step(initial, {
        type: 'RUN_STARTED',
        run: {
          runId: 1,
          reason: 'unit',
          current: 0,
          total: 10,
          sourceTotal: 10,
          blockTotal: 0,
          startedAt: Date.now(),
          currentEntityKey: null,
          currentSourcePath: null,
        },
      });
      expect(next.phase).toBe('running');
      expect(next.run?.runId).toBe(1);
    });
  });

  // ── running -> idle transitions ────────────────────────────────────────
  describe('running -> idle', () => {
    it('transitions from running to idle on QUEUE_EMPTY', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      state = step(state, { type: 'QUEUE_EMPTY' });
      expect(state.phase).toBe('idle');
    });

    it('transitions from running to idle on RUN_FINISHED', () => {
      let state = createInitialKernelState();
      state = step(state, {
        type: 'RUN_STARTED',
        run: {
          runId: 1,
          reason: 'unit',
          current: 0,
          total: 5,
          sourceTotal: 5,
          blockTotal: 0,
          startedAt: Date.now(),
          currentEntityKey: null,
          currentSourcePath: null,
        },
      });
      expect(state.phase).toBe('running');

      state = step(state, { type: 'RUN_FINISHED' });
      expect(state.phase).toBe('idle');
      expect(state.run).toBeNull();
    });
  });

  // ── running -> error transitions ───────────────────────────────────────
  describe('running -> error', () => {
    it('transitions from running to error on FATAL_ERROR', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'API key expired',
        code: 'API_KEY_EXPIRED',
      });
      expect(state.phase).toBe('error');
      expect(state.lastError).not.toBeNull();
      expect(state.lastError?.message).toBe('API key expired');
      expect(state.lastError?.code).toBe('API_KEY_EXPIRED');
    });

    it('transitions from running to error on RUN_FAILED', () => {
      let state = createInitialKernelState();
      state = step(state, {
        type: 'RUN_STARTED',
        run: {
          runId: 1,
          reason: 'unit',
          current: 0,
          total: 5,
          sourceTotal: 5,
          blockTotal: 0,
          startedAt: Date.now(),
          currentEntityKey: null,
          currentSourcePath: null,
        },
      });
      state = step(state, { type: 'RUN_FAILED', error: 'Unrecoverable error' });
      expect(state.phase).toBe('error');
      expect(state.lastError?.code).toBe('RUN_FAILED');
      expect(state.lastError?.message).toBe('Unrecoverable error');
    });

    it('transitions from running to error on MODEL_SWITCH_FAILED', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      state = step(state, {
        type: 'MODEL_SWITCH_FAILED',
        reason: 'switch',
        error: 'Model not found',
      });
      expect(state.phase).toBe('error');
      expect(state.lastError?.code).toBe('MODEL_SWITCH_FAILED');
    });
  });

  // ── error -> running transitions ───────────────────────────────────────
  describe('error -> running', () => {
    function makeErrorState() {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'API key expired',
        code: 'API_KEY_EXPIRED',
      });
      expect(state.phase).toBe('error');
      return state;
    }

    it('transitions from error to running on RETRY_SUCCESS', () => {
      const state = makeErrorState();
      const next = step(state, { type: 'RETRY_SUCCESS' });
      expect(next.phase).toBe('running');
      expect(next.lastError).toBeNull();
    });

    it('transitions from error to running on MANUAL_RETRY', () => {
      const state = makeErrorState();
      const next = step(state, { type: 'MANUAL_RETRY' });
      expect(next.phase).toBe('running');
      expect(next.lastError).toBeNull();
    });
  });

  // ── Invalid transitions (guards) ──────────────────────────────────────
  describe('invalid transitions are ignored', () => {
    it('ignores idle -> error direct transition via FATAL_ERROR', () => {
      const state = createInitialKernelState();
      expect(state.phase).toBe('idle');

      const next = step(state, {
        type: 'FATAL_ERROR',
        error: 'should not transition',
        code: 'TEST',
      });
      // FATAL_ERROR only valid from running
      expect(next.phase).toBe('idle');
    });

    it('ignores QUEUE_EMPTY when already idle', () => {
      const state = createInitialKernelState();
      const next = step(state, { type: 'QUEUE_EMPTY' });
      expect(next.phase).toBe('idle');
    });

    it('ignores QUEUE_HAS_ITEMS when already running', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      const next = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(next.phase).toBe('running');
    });

    it('ignores RETRY_SUCCESS when not in error', () => {
      const state = createInitialKernelState();
      const next = step(state, { type: 'RETRY_SUCCESS' });
      expect(next.phase).toBe('idle');
    });

    it('ignores MANUAL_RETRY when not in error', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      const next = step(state, { type: 'MANUAL_RETRY' });
      expect(next.phase).toBe('running');
    });

    it('ignores RUN_STARTED when in error phase', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'fatal',
        code: 'FATAL',
      });
      expect(state.phase).toBe('error');

      const next = step(state, {
        type: 'RUN_STARTED',
        run: {
          runId: 99,
          reason: 'should-not-start',
          current: 0,
          total: 1,
          sourceTotal: 1,
          blockTotal: 0,
          startedAt: Date.now(),
          currentEntityKey: null,
          currentSourcePath: null,
        },
      });
      expect(next.phase).toBe('error');
    });
  });

  // ── Removed states/events are no longer recognized ─────────────────────
  describe('removed states and events', () => {
    it('does not transition to stopping on STOP_REQUESTED', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      // STOP_REQUESTED should be a no-op (falls to default case)
      const next = step(state, { type: 'STOP_REQUESTED', reason: 'user' });
      expect(next.phase).not.toBe('stopping');
      // Should remain in running (event ignored or is no-op)
      expect(next.phase).toBe('running');
    });

    it('does not transition to paused on STOP_COMPLETED', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });

      const next = step(state, { type: 'STOP_COMPLETED' });
      expect(next.phase).not.toBe('paused');
    });

    it('does not recognize RESUME_REQUESTED', () => {
      let state = createInitialKernelState();
      // Even if we somehow get to error, RESUME should not be recognized
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'test',
        code: 'TEST',
      });

      const next = step(state, { type: 'RESUME_REQUESTED', reason: 'user' });
      // Should remain in error (RESUME_REQUESTED is no longer a valid event)
      expect(next.phase).toBe('error');
    });

    it('never produces booting, loading_model, stopping, or paused phases', () => {
      const removedPhases = ['booting', 'loading_model', 'stopping', 'paused'];
      const initial = createInitialKernelState();
      expect(removedPhases).not.toContain(initial.phase);

      // Exercise all valid transitions
      const events = [
        { type: 'QUEUE_HAS_ITEMS' },
        { type: 'QUEUE_EMPTY' },
        { type: 'QUEUE_HAS_ITEMS' },
        { type: 'FATAL_ERROR', error: 'test', code: 'TEST' },
        { type: 'RETRY_SUCCESS' },
        { type: 'QUEUE_EMPTY' },
      ];

      let state = initial;
      for (const event of events) {
        state = step(state, event);
        expect(removedPhases).not.toContain(state.phase);
      }
    });
  });

  // ── Model switch lifecycle ─────────────────────────────────────────────
  describe('model switch lifecycle', () => {
    it('handles MODEL_SWITCH_REQUESTED from idle', () => {
      const initial = createInitialKernelState();
      const next = step(initial, { type: 'MODEL_SWITCH_REQUESTED', reason: 'settings-change' });
      // In 3-state FSM, model switch keeps us in idle (no loading_model phase)
      expect(next.phase).toBe('idle');
      expect(next.lastError).toBeNull();
    });

    it('handles MODEL_SWITCH_SUCCEEDED', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'MODEL_SWITCH_REQUESTED', reason: 'test' });
      state = step(state, {
        type: 'MODEL_SWITCH_SUCCEEDED',
        model: {
          adapter: 'openai',
          modelKey: 'text-embedding-3-small',
          host: '',
          dims: 1536,
          fingerprint: 'openai|text-embedding-3-small|',
        },
      });
      expect(state.phase).toBe('idle');
      expect(state.model?.modelKey).toBe('text-embedding-3-small');
    });

    it('handles MODEL_SWITCH_FAILED', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'MODEL_SWITCH_REQUESTED', reason: 'test' });
      state = step(state, {
        type: 'MODEL_SWITCH_FAILED',
        reason: 'switch',
        error: 'Connection refused',
      });
      expect(state.phase).toBe('error');
      expect(state.lastError?.code).toBe('MODEL_SWITCH_FAILED');
      expect(state.lastError?.message).toBe('Connection refused');
    });
  });

  // ── Queue snapshot updates ─────────────────────────────────────────────
  describe('queue snapshot', () => {
    it('updates queue counts without changing phase', () => {
      const initial = createInitialKernelState();
      const next = step(initial, {
        type: 'QUEUE_SNAPSHOT_UPDATED',
        queue: {
          pendingJobs: 5,
          staleTotal: 10,
          staleEmbeddableTotal: 8,
          queuedTotal: 15,
        },
      });
      expect(next.phase).toBe('idle');
      expect(next.queue.pendingJobs).toBe(5);
      expect(next.queue.staleTotal).toBe(10);
    });
  });

  // ── RUN_PROGRESS ───────────────────────────────────────────────────────
  describe('run progress', () => {
    it('updates progress counters in running state', () => {
      let state = createInitialKernelState();
      state = step(state, {
        type: 'RUN_STARTED',
        run: {
          runId: 1,
          reason: 'unit',
          current: 0,
          total: 10,
          sourceTotal: 10,
          blockTotal: 0,
          startedAt: Date.now(),
          currentEntityKey: null,
          currentSourcePath: null,
        },
      });

      state = step(state, {
        type: 'RUN_PROGRESS',
        current: 5,
        total: 10,
        currentEntityKey: 'note-5',
        currentSourcePath: 'notes/note-5.md',
      });

      expect(state.phase).toBe('running');
      expect(state.run?.current).toBe(5);
      expect(state.run?.total).toBe(10);
      expect(state.run?.currentEntityKey).toBe('note-5');
      expect(state.run?.currentSourcePath).toBe('notes/note-5.md');
    });

    it('ignores RUN_PROGRESS when no run is active', () => {
      const state = createInitialKernelState();
      const next = step(state, {
        type: 'RUN_PROGRESS',
        current: 5,
        total: 10,
      });
      expect(next.run).toBeNull();
    });
  });

  // ── INIT events ────────────────────────────────────────────────────────
  describe('initialization events', () => {
    it('INIT_CORE_READY is idempotent when already idle', () => {
      const initial = createInitialKernelState();
      expect(initial.phase).toBe('idle');

      const next = step(initial, { type: 'INIT_CORE_READY' });
      expect(next.phase).toBe('idle');
    });

    it('INIT_CORE_FAILED transitions to error from idle', () => {
      const initial = createInitialKernelState();
      const next = step(initial, {
        type: 'INIT_CORE_FAILED',
        error: 'Collections failed to load',
      });
      expect(next.phase).toBe('error');
      expect(next.lastError?.code).toBe('INIT_CORE_FAILED');
    });
  });

  // ── RESET_ERROR ────────────────────────────────────────────────────────
  describe('RESET_ERROR', () => {
    it('clears lastError without changing phase', () => {
      let state = createInitialKernelState();
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'test error',
        code: 'TEST',
      });
      expect(state.lastError).not.toBeNull();

      state = step(state, { type: 'RESET_ERROR' });
      expect(state.lastError).toBeNull();
      expect(state.phase).toBe('error');
    });
  });

  // ── flags.stopRequested is removed ─────────────────────────────────────
  describe('stopRequested flag removal', () => {
    it('does not have stopRequested flag in initial state', () => {
      const initial = createInitialKernelState();
      // In 3-state FSM, the flags.stopRequested field should not exist
      expect((initial as any).flags).toBeUndefined();
    });
  });

  // ── Full lifecycle: idle -> running -> idle -> running -> error -> running -> idle
  describe('full lifecycle', () => {
    it('handles complete embedding workflow', () => {
      let state = createInitialKernelState();
      expect(state.phase).toBe('idle');

      // Queue gets items -> start running
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      // Queue empties -> back to idle
      state = step(state, { type: 'QUEUE_EMPTY' });
      expect(state.phase).toBe('idle');

      // New items arrive -> running again
      state = step(state, { type: 'QUEUE_HAS_ITEMS' });
      expect(state.phase).toBe('running');

      // Fatal error
      state = step(state, {
        type: 'FATAL_ERROR',
        error: 'API key revoked',
        code: 'API_KEY_REVOKED',
      });
      expect(state.phase).toBe('error');
      expect(state.lastError?.message).toBe('API key revoked');

      // Retry success -> back to running
      state = step(state, { type: 'RETRY_SUCCESS' });
      expect(state.phase).toBe('running');
      expect(state.lastError).toBeNull();

      // Finish -> idle
      state = step(state, { type: 'QUEUE_EMPTY' });
      expect(state.phase).toBe('idle');
    });
  });
});
