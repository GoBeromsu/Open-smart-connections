/**
 * @file embedding/kernel/store.ts
 * @description Minimal event store for embedding kernel state
 */

import { createInitialKernelState, reduceEmbeddingKernelState } from './reducer';
import type {
  EmbeddingKernelEvent,
  EmbeddingKernelListener,
  EmbeddingKernelState,
} from './types';

export class EmbeddingKernelStore {
  private state: EmbeddingKernelState;
  private listeners: Set<EmbeddingKernelListener> = new Set();

  constructor(initialState?: EmbeddingKernelState) {
    this.state = initialState ?? createInitialKernelState();
  }

  getState(): EmbeddingKernelState {
    return this.state;
  }

  dispatch(event: EmbeddingKernelEvent): EmbeddingKernelState {
    const prev = this.state;
    const next = reduceEmbeddingKernelState(prev, event);
    this.state = next;

    for (const listener of this.listeners) {
      listener(next, prev, event);
    }

    return next;
  }

  subscribe(listener: EmbeddingKernelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
