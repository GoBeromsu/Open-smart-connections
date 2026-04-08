import type { ParsedEmbedRuntimeState } from '../types/embed-runtime';
import type { SmartConnectionsPlugin } from './settings-types';

export function getRuntimeState(plugin: SmartConnectionsPlugin): ParsedEmbedRuntimeState | null {
  return plugin.getEmbedRuntimeState?.() ?? null;
}

export function getRunStateLabel(
  status: NonNullable<SmartConnectionsPlugin['status_state']>,
  runtime: ParsedEmbedRuntimeState | null,
): string {
  if (runtime?.serving.kind === 'degraded') return 'Degraded';
  switch (status) {
    case 'embedding':
      return 'Running';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function getRunStateTone(
  status: NonNullable<SmartConnectionsPlugin['status_state']>,
  runtime: ParsedEmbedRuntimeState | null,
): 'ready' | 'loading' | 'error' {
  if (runtime?.serving.kind === 'degraded') return 'error';
  switch (status) {
    case 'error':
      return 'error';
    case 'embedding':
      return 'ready';
    default:
      return 'loading';
  }
}

export function getEmbeddingPill(
  plugin: SmartConnectionsPlugin,
  runtime: ParsedEmbedRuntimeState | null,
): { value: string; active: boolean; tone: 'ready' | 'loading' | 'error' } {
  if (runtime?.serving.kind === 'degraded') {
    return { value: 'Degraded', active: false, tone: 'error' };
  }
  if (runtime?.serving.kind === 'unavailable') {
    return { value: 'Unavailable', active: false, tone: 'error' };
  }
  if (runtime?.serving.kind === 'loading') {
    return { value: 'Loading', active: false, tone: 'loading' };
  }
  return {
    value: plugin.embed_ready ? 'Ready' : 'Loading',
    active: !!plugin.embed_ready,
    tone: plugin.embed_ready ? 'ready' : 'loading',
  };
}
