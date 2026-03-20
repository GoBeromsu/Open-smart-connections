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

/** Skip noisy events that fire on every batch progress tick */
const SILENT_EVENTS = new Set(['RUN_PROGRESS', 'QUEUE_SNAPSHOT_UPDATED']);

export function logKernelTransition(
  _plugin: unknown,
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
  next: EmbeddingKernelState,
): void {
  // Suppress high-frequency events that add no diagnostic value
  if (SILENT_EVENTS.has(event.type)) return;
  // Skip no-op transitions (same phase, no new info)
  if (prev.phase === next.phase && !('error' in event) && !('reason' in event)) return;

  const reason = 'reason' in event ? String((event as any).reason || '') : '';
  const error = 'error' in event ? String((event as any).error || '') : '';
  const parts: string[] = [`[Open Connections]`];

  if (prev.phase !== next.phase) {
    parts.push(`${prev.phase} → ${next.phase}`);
  } else {
    parts.push(event.type);
  }

  if (reason) parts.push(`(${reason})`);
  if (error) parts.push(`error: ${error}`);

  const run = next.run;
  if (run) parts.push(`${run.current}/${run.total}`);

  console.log(parts.join(' '));
}
