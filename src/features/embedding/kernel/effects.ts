/**
 * @file embedding/kernel/effects.ts
 * @description Effect helpers for kernel transition logging and model normalization
 */

import type {
  EmbeddingKernelEvent,
  EmbeddingKernelState,
} from './types';

export function buildKernelModel(
  adapter: string,
  modelKey: string,
  host: string,
  dims: number | null,
): {
  adapter: string;
  modelKey: string;
  host: string;
  dims: number | null;
  fingerprint: string;
} {
  const normalizedAdapter = (adapter || '').trim().toLowerCase();
  const normalizedModel = (modelKey || '').trim().toLowerCase();
  const normalizedHost = (host || '').trim().toLowerCase();
  return {
    adapter: normalizedAdapter,
    modelKey: normalizedModel,
    host: normalizedHost,
    dims,
    fingerprint: `${normalizedAdapter}|${normalizedModel}|${normalizedHost}`,
  };
}

export function logKernelTransition(
  _plugin: unknown,
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
  next: EmbeddingKernelState,
): void {
  const reason = 'reason' in event ? String((event as any).reason || '') : '';
  const error = 'error' in event ? String((event as any).error || '') : '';
  const suffixReason = reason ? ` reason="${reason}"` : '';
  const suffixError = error ? ` error="${error}"` : '';
  const runId = next.run?.runId ?? prev.run?.runId ?? '-';
  console.log(
    `[SC][FSM] ${prev.phase} --${event.type}--> ${next.phase} run=${runId} jobs=${next.queue.pendingJobs}${suffixReason}${suffixError}`,
  );
}
