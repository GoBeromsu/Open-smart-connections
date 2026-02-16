/**
 * @file embedding-kernel-queue.test.ts
 * @description Priority, dedupe, and single-worker behavior tests for kernel queue
 */

import { describe, expect, it, vi } from 'vitest';
import { EmbeddingKernelJobQueue } from '../src/features/embedding/kernel/queue';

describe('EmbeddingKernelJobQueue', () => {
  it('runs higher-priority jobs first', async () => {
    const queue = new EmbeddingKernelJobQueue();
    const order: string[] = [];

    const p1 = queue.enqueue({
      type: 'RUN_EMBED_BATCH',
      key: 'job-low',
      priority: 30,
      run: async () => {
        order.push('low');
        return 'low';
      },
    });

    const p2 = queue.enqueue({
      type: 'MODEL_SWITCH',
      key: 'job-high',
      priority: 5,
      run: async () => {
        order.push('high');
        return 'high';
      },
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['high', 'low']);
  });

  it('dedupes jobs by key', async () => {
    const queue = new EmbeddingKernelJobQueue();
    const run = vi.fn(async () => 'ok');

    const p1 = queue.enqueue({
      type: 'REFRESH_REQUEST',
      key: 'REFRESH_REQUEST',
      priority: 20,
      run,
    });

    const p2 = queue.enqueue({
      type: 'REFRESH_REQUEST',
      key: 'REFRESH_REQUEST',
      priority: 20,
      run,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('ok');
    expect(r2).toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('processes one job at a time', async () => {
    const queue = new EmbeddingKernelJobQueue();
    let active = 0;
    let maxActive = 0;

    const makeJob = (key: string, priority: number) => queue.enqueue({
      type: 'RUN_EMBED_BATCH',
      key,
      priority,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return key;
      },
    });

    await Promise.all([
      makeJob('a', 30),
      makeJob('b', 30),
      makeJob('c', 30),
    ]);

    expect(maxActive).toBe(1);
  });
});
