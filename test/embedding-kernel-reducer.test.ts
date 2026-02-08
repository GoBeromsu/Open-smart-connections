/**
 * @file embedding-kernel-reducer.test.ts
 * @description Transition table tests for embedding kernel reducer
 */

import { describe, expect, it } from 'vitest';
import {
  createInitialKernelState,
  reduceEmbeddingKernelState,
} from '../src/embedding/kernel/reducer';

function step(state: ReturnType<typeof createInitialKernelState>, event: any) {
  return reduceEmbeddingKernelState(state, event);
}

describe('embedding kernel reducer', () => {
  it('transitions model switch lifecycle', () => {
    const initial = createInitialKernelState();
    const loading = step(initial, { type: 'MODEL_SWITCH_REQUESTED', reason: 'test' });
    expect(loading.phase).toBe('loading_model');

    const ready = step(loading, {
      type: 'MODEL_SWITCH_SUCCEEDED',
      model: {
        adapter: 'openai',
        modelKey: 'text-embedding-3-small',
        host: '',
        dims: 1536,
        fingerprint: 'openai|text-embedding-3-small|',
      },
    });
    expect(ready.phase).toBe('idle');
    expect(ready.model?.modelKey).toBe('text-embedding-3-small');
  });

  it('transitions run lifecycle with stop', () => {
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
    expect(state.phase).toBe('running');

    state = step(state, { type: 'STOP_REQUESTED', reason: 'stop' });
    expect(state.phase).toBe('stopping');
    expect(state.flags.stopRequested).toBe(true);

    state = step(state, { type: 'STOP_COMPLETED' });
    expect(state.phase).toBe('paused');
    expect(state.flags.stopRequested).toBe(false);
  });

  it('captures errors on failures', () => {
    let state = createInitialKernelState();
    state = step(state, {
      type: 'MODEL_SWITCH_FAILED',
      reason: 'switch',
      error: 'boom',
    });

    expect(state.phase).toBe('error');
    expect(state.lastError?.code).toBe('MODEL_SWITCH_FAILED');
    expect(state.lastError?.message).toBe('boom');
  });
});
