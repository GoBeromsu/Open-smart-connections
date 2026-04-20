import type { ConnectionResult } from '../../types/entities';
import { ConnectionsResultCache } from './result-cache';

export type RenderDecision =
  | { kind: 'serve_cached'; results: readonly ConnectionResult[] }
  | { kind: 'compute_fresh' }
  | { kind: 'revalidate_in_background'; staleResults: readonly ConnectionResult[] };

export function decideRender(
  input: { path: string; fingerprint: string; kernelPhase: 'idle' | 'running' | 'error' },
  cache: ConnectionsResultCache,
): RenderDecision {
  const cached = cache.get(input.path, input.fingerprint);
  if (!cached) return { kind: 'compute_fresh' };
  if (input.kernelPhase === 'running') {
    return { kind: 'revalidate_in_background', staleResults: cached };
  }
  return { kind: 'serve_cached', results: cached };
}
