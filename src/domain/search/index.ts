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
} from './embedding-pipeline';
