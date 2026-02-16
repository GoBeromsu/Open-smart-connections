/**
 * @file embedding/queue/embed-job-queue.ts
 * @description Unified FIFO embedding queue with dedup by entityKey (Latest-Write-Wins)
 *
 * Replaces the previous scattered queue mechanisms:
 *   - re_import_queue (Record<string, {path, queued_at}>)
 *   - _queue_embed flag (per-entity boolean)
 *   - embed_queue getter (collection property)
 */

export interface EmbedJob {
  entityKey: string;
  contentHash: string;
  sourcePath: string;
  enqueuedAt: number;
}

export interface EmbedJobQueueOptions {
  onQueueHasItems?: () => void;
  onQueueEmpty?: () => void;
}

export class EmbedJobQueue {
  private items: Map<string, EmbedJob> = new Map();
  private insertionOrder: string[] = [];
  private onQueueHasItems?: () => void;
  private onQueueEmpty?: () => void;

  constructor(opts?: EmbedJobQueueOptions) {
    this.onQueueHasItems = opts?.onQueueHasItems;
    this.onQueueEmpty = opts?.onQueueEmpty;
  }

  enqueue(job: EmbedJob): void {
    const wasEmpty = this.items.size === 0;
    if (this.items.has(job.entityKey)) {
      // Latest-Write-Wins: update data, keep original FIFO position
      this.items.set(job.entityKey, job);
    } else {
      this.items.set(job.entityKey, job);
      this.insertionOrder.push(job.entityKey);
    }
    if (wasEmpty && this.items.size > 0) {
      this.onQueueHasItems?.();
    }
  }

  dequeue(): EmbedJob | undefined {
    while (this.insertionOrder.length > 0) {
      const key = this.insertionOrder.shift()!;
      const job = this.items.get(key);
      if (job) {
        this.items.delete(key);
        if (this.items.size === 0) {
          this.onQueueEmpty?.();
        }
        return job;
      }
      // Key was already removed (stale entry in insertionOrder), skip
    }
    return undefined;
  }

  peek(): EmbedJob | undefined {
    for (const key of this.insertionOrder) {
      const job = this.items.get(key);
      if (job) return job;
    }
    return undefined;
  }

  has(entityKey: string): boolean {
    return this.items.has(entityKey);
  }

  get(entityKey: string): EmbedJob | undefined {
    return this.items.get(entityKey);
  }

  remove(entityKey: string): boolean {
    if (!this.items.has(entityKey)) return false;
    this.items.delete(entityKey);
    // insertionOrder will have a stale entry; dequeue/toArray/peek skip stale keys
    if (this.items.size === 0) {
      this.insertionOrder = [];
      this.onQueueEmpty?.();
    }
    return true;
  }

  /** Remove all jobs whose sourcePath matches the given path. */
  removeBySourcePath(sourcePath: string): number {
    let removed = 0;
    for (const [key, job] of this.items) {
      if (job.sourcePath === sourcePath) {
        this.items.delete(key);
        removed++;
      }
    }
    if (removed > 0 && this.items.size === 0) {
      this.insertionOrder = [];
      this.onQueueEmpty?.();
    }
    return removed;
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    const wasNonEmpty = this.items.size > 0;
    this.items.clear();
    this.insertionOrder = [];
    if (wasNonEmpty) {
      this.onQueueEmpty?.();
    }
  }

  toArray(): EmbedJob[] {
    const result: EmbedJob[] = [];
    const seen = new Set<string>();
    for (const key of this.insertionOrder) {
      if (seen.has(key)) continue;
      seen.add(key);
      const job = this.items.get(key);
      if (job) result.push(job);
    }
    return result;
  }
}
