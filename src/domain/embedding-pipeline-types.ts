import type { EmbeddingEntity } from '../types/entities';
import type { EmbedModelAdapter } from '../types/models';
import type { EmbedRunOutcome } from '../types/embed-runtime';

export class BatchIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchIntegrityError';
  }
}

export interface EmbedQueueStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  outcome: EmbedRunOutcome;
  error?: string;
}

export interface EmbedPipelineOptions {
  batch_size?: number;
  max_retries?: number;
  concurrency?: number;
  on_progress?: (
    current: number,
    total: number,
    progress?: EmbedProgressSnapshot,
  ) => void;
  on_save?: () => Promise<void>;
  save_interval?: number;
  expected_hashes?: Record<string, string>;
}

export interface EmbedProgressSnapshot {
  current_key: string | null;
  current_source_path: string | null;
}

export interface EmbedPipelineRuntime {
  model: EmbedModelAdapter;
  stats: EmbedQueueStats;
  should_halt: () => boolean;
  request_halt: () => void;
}

export function create_empty_stats(): EmbedQueueStats {
  return {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    duration_ms: 0,
    outcome: 'completed',
    error: undefined,
  };
}

export function build_batches(
  entities: EmbeddingEntity[],
  batch_size: number,
): EmbeddingEntity[][] {
  const batches: EmbeddingEntity[][] = [];
  for (let i = 0; i < entities.length; i += batch_size) {
    batches.push(entities.slice(i, i + batch_size));
  }
  return batches;
}
