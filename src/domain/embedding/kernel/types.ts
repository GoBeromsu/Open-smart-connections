/**
 * @file embedding/kernel/types.ts
 * @description Job types for the embedding job queue
 */

export type EmbeddingKernelJobType =
  | 'MODEL_SWITCH'
  | 'RUN_EMBED_BATCH'
  | 'RUN_EMBED_FOLLOWUP'
  | 'REIMPORT_SOURCES'
  | 'REFRESH_REQUEST';

export interface EmbeddingKernelJob<T = unknown> {
  type: EmbeddingKernelJobType;
  key: string;
  priority: number;
  payload?: unknown;
  run: () => Promise<T>;
}
