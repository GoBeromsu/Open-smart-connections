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
    case 'booting':
      return 'loading_model';
    default:
      return state.phase;
  }
}

export function isEmbedReady(state: EmbeddingKernelState): boolean {
  if (!state.model) return false;
  return !['booting', 'loading_model', 'error'].includes(state.phase);
}

export function isKernelBusy(state: EmbeddingKernelState): boolean {
  return ['loading_model', 'running', 'stopping'].includes(state.phase);
}
