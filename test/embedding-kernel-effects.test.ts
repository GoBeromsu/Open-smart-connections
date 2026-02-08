/**
 * @file embedding-kernel-effects.test.ts
 * @description Kernel effect helper tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildKernelModel,
  logKernelTransition,
} from '../src/embedding/kernel/effects';
import { createInitialKernelState } from '../src/embedding/kernel/reducer';

describe('kernel effects', () => {
  it('normalizes kernel model fingerprint', () => {
    const model = buildKernelModel('OpenAI', ' Text-Embedding-3-Small ', ' HTTP://LOCALHOST ', 1536);
    expect(model.adapter).toBe('openai');
    expect(model.modelKey).toBe('text-embedding-3-small');
    expect(model.host).toBe('http://localhost');
    expect(model.fingerprint).toBe('openai|text-embedding-3-small|http://localhost');
  });

  it('logs transition line with context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = {} as any;
    const prev = createInitialKernelState();
    const next = {
      ...prev,
      phase: 'loading_model' as const,
      queue: {
        ...prev.queue,
        pendingJobs: 1,
      },
    };
    logKernelTransition(plugin, prev, { type: 'MODEL_SWITCH_REQUESTED', reason: 'unit' }, next);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[SC][FSM] booting --MODEL_SWITCH_REQUESTED--> loading_model'));
    spy.mockRestore();
  });
});
