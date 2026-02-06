/**
 * @file index.ts
 * @description Barrel exports for search module
 */

export {
  findNearest,
  findFurthest,
  findNearestToEntity,
} from './vector-search';

export {
  EmbeddingPipeline,
  type EmbedQueueStats,
  type EmbedPipelineOptions,
} from './embedding-pipeline';

export {
  find_connections,
  get_source_path,
  type FindConnectionsOptions,
} from './find-connections';

export {
  lookup,
  batch_lookup,
  type LookupOptions,
} from './lookup';
