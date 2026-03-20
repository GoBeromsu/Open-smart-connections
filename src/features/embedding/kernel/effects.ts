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
  prev: EmbeddingKernelState,
  event: EmbeddingKernelEvent,
  next: EmbeddingKernelState,
): void {
  if (SILENT_EVENTS.has(event.type)) return;
  if (prev.phase === next.phase && !('error' in event) && !('reason' in event)) return;

  const reason = 'reason' in event ? String((event as Record<string, unknown>).reason ?? '') : '';
  const error = 'error' in event ? String((event as Record<string, unknown>).error ?? '') : '';
  const parts: string[] = ['[Open Connections]'];

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
