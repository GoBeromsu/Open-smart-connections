/**
 * @file embedding/kernel/selectors.ts
 * @description Derived selectors for kernel state and legacy compatibility
 */

import type { EmbeddingKernelState } from './types';

/** Lightweight status for UI consumers (status bar, settings) */
export type EmbedStatusState = 'idle' | 'embedding' | 'error';

export function toLegacyStatusState(state: EmbeddingKernelState): EmbedStatusState {
  switch (state.phase) {
    case 'running':
      return 'embedding';
    default:
      return state.phase;
  }
}

export function isEmbedReady(state: EmbeddingKernelState): boolean {
  if (!state.model) return false;
  return state.phase !== 'error';
}

