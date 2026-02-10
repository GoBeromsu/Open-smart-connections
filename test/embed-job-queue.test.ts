/**
 * @file embed-job-queue.test.ts
 * @description TDD tests for Phase 2: Unified EmbedJobQueue
 *
 * Phase 2 unifies 4 disparate queue mechanisms into a single EmbedJobQueue:
 *   - re_import_queue (Record<string, {path, queued_at}>)
 *   - _queue_embed flag (per-entity boolean)
 *   - embed_queue getter (collection property)
 *   - EmbeddingKernelJobQueue (priority queue for orchestration)
 *
 * The new EmbedJobQueue is:
 *   - FIFO ordered (insertion order preserved)
 *   - Map-based dedup by entityKey (Latest-Write-Wins)
 *   - Emits QUEUE_HAS_ITEMS when first item arrives in empty queue
 *   - Emits QUEUE_EMPTY when last item is consumed
 */

import { describe, expect, it, vi } from 'vitest';
import { EmbedJobQueue, type EmbedJob } from '../src/embedding/queue/embed-job-queue';

function makeJob(entityKey: string, contentHash: string = 'hash-' + entityKey): EmbedJob {
  return {
    entityKey,
    contentHash,
    sourcePath: entityKey.split('#')[0],
    enqueuedAt: Date.now(),
  };
}

describe('EmbedJobQueue (unified queue)', () => {
  // ── FIFO ordering ──────────────────────────────────────────────────
  describe('FIFO ordering', () => {
    it('dequeues items in insertion order', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note-a.md'));
      queue.enqueue(makeJob('note-b.md'));
      queue.enqueue(makeJob('note-c.md'));

      expect(queue.dequeue()?.entityKey).toBe('note-a.md');
      expect(queue.dequeue()?.entityKey).toBe('note-b.md');
      expect(queue.dequeue()?.entityKey).toBe('note-c.md');
      expect(queue.dequeue()).toBeUndefined();
    });

    it('maintains FIFO order across interleaved enqueue/dequeue', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      expect(queue.dequeue()?.entityKey).toBe('a');

      queue.enqueue(makeJob('c'));
      expect(queue.dequeue()?.entityKey).toBe('b');
      expect(queue.dequeue()?.entityKey).toBe('c');
    });
  });

  // ── Dedup (Latest-Write-Wins) ──────────────────────────────────────
  describe('dedup (Latest-Write-Wins)', () => {
    it('replaces existing entry with same entityKey', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md', 'hash-v1'));
      queue.enqueue(makeJob('note.md', 'hash-v2'));

      expect(queue.size()).toBe(1);
      const item = queue.dequeue();
      expect(item?.entityKey).toBe('note.md');
      expect(item?.contentHash).toBe('hash-v2');
    });

    it('preserves FIFO position when replacing', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.enqueue(makeJob('a', 'hash-a-v2'));

      // 'a' should still come first (original position preserved)
      expect(queue.dequeue()?.entityKey).toBe('a');
      expect(queue.dequeue()?.entityKey).toBe('b');
    });

    it('Latest-Write-Wins: most recent contentHash is used', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md', 'hash-1'));
      queue.enqueue(makeJob('note.md', 'hash-2'));
      queue.enqueue(makeJob('note.md', 'hash-3'));

      expect(queue.size()).toBe(1);
      expect(queue.dequeue()?.contentHash).toBe('hash-3');
    });

    it('does not dedup different entityKeys', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note-a.md'));
      queue.enqueue(makeJob('note-b.md'));

      expect(queue.size()).toBe(2);
    });

    it('deduplicates block keys within same source', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md#block-1', 'hash-v1'));
      queue.enqueue(makeJob('note.md#block-2', 'hash-v1'));
      queue.enqueue(makeJob('note.md#block-1', 'hash-v2'));

      expect(queue.size()).toBe(2);
      const first = queue.dequeue()!;
      expect(first.entityKey).toBe('note.md#block-1');
      expect(first.contentHash).toBe('hash-v2');
    });
  });

  // ── Burst update ───────────────────────────────────────────────────
  describe('burst update behavior', () => {
    it('100 rapid updates to same file result in single queue entry', () => {
      const queue = new EmbedJobQueue();
      for (let i = 0; i < 100; i++) {
        queue.enqueue(makeJob('rapid-file.md', `hash-${i}`));
      }

      expect(queue.size()).toBe(1);
      const item = queue.dequeue();
      expect(item?.contentHash).toBe('hash-99');
    });

    it('burst updates to multiple files keep all files queued', () => {
      const queue = new EmbedJobQueue();
      for (let i = 0; i < 50; i++) {
        queue.enqueue(makeJob('file-a.md', `a-hash-${i}`));
        queue.enqueue(makeJob('file-b.md', `b-hash-${i}`));
      }

      expect(queue.size()).toBe(2);
      expect(queue.dequeue()?.contentHash).toBe('a-hash-49');
      expect(queue.dequeue()?.contentHash).toBe('b-hash-49');
    });
  });

  // ── Size reporting ─────────────────────────────────────────────────
  describe('size reporting', () => {
    it('reports 0 for empty queue', () => {
      const queue = new EmbedJobQueue();
      expect(queue.size()).toBe(0);
    });

    it('reports correct size after enqueue', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.enqueue(makeJob('c'));
      expect(queue.size()).toBe(3);
    });

    it('size decreases on dequeue', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.dequeue();
      expect(queue.size()).toBe(1);
    });

    it('size does not increase on dedup replace', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a', 'v1'));
      queue.enqueue(makeJob('a', 'v2'));
      expect(queue.size()).toBe(1);
    });
  });

  // ── has() and get() ────────────────────────────────────────────────
  describe('has() and get()', () => {
    it('has() returns true for queued items', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md'));
      expect(queue.has('note.md')).toBe(true);
      expect(queue.has('missing.md')).toBe(false);
    });

    it('get() returns the latest version of queued item', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md', 'v1'));
      queue.enqueue(makeJob('note.md', 'v2'));
      expect(queue.get('note.md')?.contentHash).toBe('v2');
    });

    it('has() returns false after item is dequeued', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md'));
      queue.dequeue();
      expect(queue.has('note.md')).toBe(false);
    });
  });

  // ── peek() ─────────────────────────────────────────────────────────
  describe('peek()', () => {
    it('returns first item without removing it', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));

      expect(queue.peek()?.entityKey).toBe('a');
      expect(queue.size()).toBe(2);
    });

    it('returns undefined for empty queue', () => {
      const queue = new EmbedJobQueue();
      expect(queue.peek()).toBeUndefined();
    });
  });

  // ── clear() ────────────────────────────────────────────────────────
  describe('clear()', () => {
    it('removes all items', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  // ── toArray() ──────────────────────────────────────────────────────
  describe('toArray()', () => {
    it('returns items in FIFO order', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.enqueue(makeJob('c'));

      const arr = queue.toArray();
      expect(arr.map(j => j.entityKey)).toEqual(['a', 'b', 'c']);
    });

    it('returns latest version for deduped items', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a', 'v1'));
      queue.enqueue(makeJob('b', 'v1'));
      queue.enqueue(makeJob('a', 'v2'));

      const arr = queue.toArray();
      expect(arr).toHaveLength(2);
      expect(arr[0].entityKey).toBe('a');
      expect(arr[0].contentHash).toBe('v2');
      expect(arr[1].entityKey).toBe('b');
    });
  });

  // ── FSM event integration ──────────────────────────────────────────
  describe('FSM event callbacks', () => {
    it('fires onQueueHasItems when first item is enqueued', () => {
      const onHasItems = vi.fn();
      const queue = new EmbedJobQueue({ onQueueHasItems: onHasItems });

      queue.enqueue(makeJob('a'));
      expect(onHasItems).toHaveBeenCalledTimes(1);
    });

    it('does not fire onQueueHasItems when queue already has items', () => {
      const onHasItems = vi.fn();
      const queue = new EmbedJobQueue({ onQueueHasItems: onHasItems });

      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      expect(onHasItems).toHaveBeenCalledTimes(1);
    });

    it('fires onQueueEmpty when last item is dequeued', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.dequeue();
      expect(onEmpty).toHaveBeenCalledTimes(1);
    });

    it('does not fire onQueueEmpty when items remain', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.dequeue();
      expect(onEmpty).not.toHaveBeenCalled();
    });

    it('fires onQueueEmpty on clear() when queue was non-empty', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.clear();
      expect(onEmpty).toHaveBeenCalledTimes(1);
    });

    it('does not fire onQueueEmpty on clear() when queue was already empty', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.clear();
      expect(onEmpty).not.toHaveBeenCalled();
    });

    it('re-fires onQueueHasItems after queue empties and refills', () => {
      const onHasItems = vi.fn();
      const queue = new EmbedJobQueue({ onQueueHasItems: onHasItems });

      queue.enqueue(makeJob('a'));
      queue.dequeue(); // empties
      queue.enqueue(makeJob('b'));
      expect(onHasItems).toHaveBeenCalledTimes(2);
    });

    it('does not fire onQueueHasItems on dedup replace in non-empty queue', () => {
      const onHasItems = vi.fn();
      const queue = new EmbedJobQueue({ onQueueHasItems: onHasItems });

      queue.enqueue(makeJob('a', 'v1'));
      queue.enqueue(makeJob('a', 'v2')); // dedup replace, queue was not empty
      expect(onHasItems).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('dequeue on empty queue returns undefined', () => {
      const queue = new EmbedJobQueue();
      expect(queue.dequeue()).toBeUndefined();
    });

    it('handles enqueue after complete drain', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.dequeue();

      queue.enqueue(makeJob('b'));
      expect(queue.size()).toBe(1);
      expect(queue.dequeue()?.entityKey).toBe('b');
    });

    it('handles entity keys with special characters', () => {
      const queue = new EmbedJobQueue();
      const key = 'folder/sub folder/note (1).md#heading with spaces';
      queue.enqueue(makeJob(key));
      expect(queue.has(key)).toBe(true);
      expect(queue.dequeue()?.entityKey).toBe(key);
    });
  });
});
