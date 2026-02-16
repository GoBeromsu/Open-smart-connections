/**
 * @file embedding/kernel/queue.ts
 * @description Single-worker priority queue with dedupe for embedding kernel jobs
 */

import type { EmbeddingKernelJob } from './types';

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

  isRunning(): boolean {
    return this.running;
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
