/**
 * @file embedding-pipeline.ts
 * @description Public embedding pipeline facade.
 */

import type { EmbeddingEntity } from '../types/entities';
import {
  create_empty_stats,
  type EmbedPipelineOptions,
  type EmbedQueueStats,
} from './embedding-pipeline-types';
import { execute_embedding_process } from './embedding-pipeline-process';
import type { EmbedModelAdapter } from '../types/models';

export type {
  EmbedPipelineOptions,
  EmbedProgressSnapshot,
  EmbedQueueStats,
} from './embedding-pipeline-types';

export class EmbeddingPipeline {
  private readonly model: EmbedModelAdapter;
  private is_processing = false;
  private should_halt_flag = false;
  private stats: EmbedQueueStats = create_empty_stats();

  constructor(model: EmbedModelAdapter) {
    this.model = model;
  }

  async process(
    entities: EmbeddingEntity[],
    opts: EmbedPipelineOptions = {},
  ): Promise<EmbedQueueStats> {
    if (this.is_processing) {
      throw new Error('Embedding pipeline is already processing');
    }

    this.is_processing = true;
    this.should_halt_flag = false;
    this.stats = create_empty_stats();

    try {
      return await execute_embedding_process(
        {
          model: this.model,
          stats: this.stats,
          should_halt: () => this.should_halt_flag,
          request_halt: () => {
            this.should_halt_flag = true;
          },
        },
        entities,
        opts,
      );
    } finally {
      this.is_processing = false;
    }
  }

  halt(): void {
    this.should_halt_flag = true;
  }

  is_active(): boolean {
    return this.is_processing;
  }

  get_stats(): EmbedQueueStats {
    return { ...this.stats };
  }
}
