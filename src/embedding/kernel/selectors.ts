/**
 * @file embedding/kernel/selectors.ts
 * @description Derived selectors for kernel state and legacy compatibility
 */

import type { EmbedStatusState } from '../../main';
import type { EmbeddingKernelState } from './types';

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

export function isKernelBusy(state: EmbeddingKernelState): boolean {
  return state.phase === 'running';
}
