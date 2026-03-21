/**
 * @file embed-job-queue.test.ts
 * @description TDD tests for EmbedJobQueue - FIFO queue with Latest-Write-Wins dedup
 */

import { describe, expect, it, vi } from 'vitest';
import { EmbedJobQueue, type EmbedJob } from '../src/domain/embedding/queue/embed-job-queue';

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
    it('returns items in insertion order via toArray()', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note-a.md'));
      queue.enqueue(makeJob('note-b.md'));
      queue.enqueue(makeJob('note-c.md'));

      const arr = queue.toArray();
      expect(arr[0]?.entityKey).toBe('note-a.md');
      expect(arr[1]?.entityKey).toBe('note-b.md');
      expect(arr[2]?.entityKey).toBe('note-c.md');
    });

    it('maintains FIFO order — toArray reflects insertion sequence', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.enqueue(makeJob('c'));

      const arr = queue.toArray();
      expect(arr.map(j => j.entityKey)).toEqual(['a', 'b', 'c']);
    });
  });

  // ── Dedup (Latest-Write-Wins) ──────────────────────────────────────
  describe('dedup (Latest-Write-Wins)', () => {
    it('replaces existing entry with same entityKey', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md', 'hash-v1'));
      queue.enqueue(makeJob('note.md', 'hash-v2'));

      expect(queue.size()).toBe(1);
      const arr = queue.toArray();
      expect(arr[0]?.entityKey).toBe('note.md');
      expect(arr[0]?.contentHash).toBe('hash-v2');
    });

    it('preserves FIFO position when replacing', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.enqueue(makeJob('a', 'hash-a-v2'));

      // 'a' should still come first (original position preserved)
      const arr = queue.toArray();
      expect(arr[0]?.entityKey).toBe('a');
      expect(arr[1]?.entityKey).toBe('b');
    });

    it('Latest-Write-Wins: most recent contentHash is used', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('note.md', 'hash-1'));
      queue.enqueue(makeJob('note.md', 'hash-2'));
      queue.enqueue(makeJob('note.md', 'hash-3'));

      expect(queue.size()).toBe(1);
      expect(queue.toArray()[0]?.contentHash).toBe('hash-3');
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
      const arr = queue.toArray();
      expect(arr[0]?.entityKey).toBe('note.md#block-1');
      expect(arr[0]?.contentHash).toBe('hash-v2');
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
      expect(queue.toArray()[0]?.contentHash).toBe('hash-99');
    });

    it('burst updates to multiple files keep all files queued', () => {
      const queue = new EmbedJobQueue();
      for (let i = 0; i < 50; i++) {
        queue.enqueue(makeJob('file-a.md', `a-hash-${i}`));
        queue.enqueue(makeJob('file-b.md', `b-hash-${i}`));
      }

      expect(queue.size()).toBe(2);
      const arr = queue.toArray();
      expect(arr[0]?.contentHash).toBe('a-hash-49');
      expect(arr[1]?.contentHash).toBe('b-hash-49');
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

    it('size decreases after removeBySourcePath', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.removeBySourcePath('a');
      expect(queue.size()).toBe(1);
    });

    it('size does not increase on dedup replace', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a', 'v1'));
      queue.enqueue(makeJob('a', 'v2'));
      expect(queue.size()).toBe(1);
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
      expect(queue.toArray()).toHaveLength(0);
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

    it('returns empty array for empty queue', () => {
      const queue = new EmbedJobQueue();
      expect(queue.toArray()).toHaveLength(0);
    });
  });

  // ── removeBySourcePath() ───────────────────────────────────────────
  describe('removeBySourcePath()', () => {
    it('removes all jobs matching the given source path', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('folder/note.md'));
      queue.enqueue(makeJob('folder/note.md#block-1'));
      queue.enqueue(makeJob('other.md'));

      const removed = queue.removeBySourcePath('folder/note.md');
      expect(removed).toBe(2);
      expect(queue.size()).toBe(1);
      expect(queue.toArray()[0]?.entityKey).toBe('other.md');
    });

    it('fires onQueueEmpty when removing the last item', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.removeBySourcePath('a');
      expect(onEmpty).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no matching jobs found', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a.md'));

      const removed = queue.removeBySourcePath('b.md');
      expect(removed).toBe(0);
      expect(queue.size()).toBe(1);
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

    it('fires onQueueEmpty when all items are removed via removeBySourcePath', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.removeBySourcePath('a');
      expect(onEmpty).toHaveBeenCalledTimes(1);
    });

    it('does not fire onQueueEmpty when items remain after removeBySourcePath', () => {
      const onEmpty = vi.fn();
      const queue = new EmbedJobQueue({ onQueueEmpty: onEmpty });

      queue.enqueue(makeJob('a'));
      queue.enqueue(makeJob('b'));
      queue.removeBySourcePath('a');
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
      queue.clear(); // empties
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
    it('toArray on empty queue returns empty array', () => {
      const queue = new EmbedJobQueue();
      expect(queue.toArray()).toEqual([]);
    });

    it('handles enqueue after complete drain via clear()', () => {
      const queue = new EmbedJobQueue();
      queue.enqueue(makeJob('a'));
      queue.clear();

      queue.enqueue(makeJob('b'));
      expect(queue.size()).toBe(1);
      expect(queue.toArray()[0]?.entityKey).toBe('b');
    });

    it('handles entity keys with special characters', () => {
      const queue = new EmbedJobQueue();
      const key = 'folder/sub folder/note (1).md#heading with spaces';
      queue.enqueue(makeJob(key));
      expect(queue.size()).toBe(1);
      expect(queue.toArray()[0]?.entityKey).toBe(key);
    });
  });
});
