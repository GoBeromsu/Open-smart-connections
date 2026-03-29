/**
 * @file embed-orchestrator.ts
 * @description Facade exports for embedding orchestration.
 */

import './embedding/register-embed-adapters';

export {
  clearEmbedNotice,
  emitEmbedProgress,
  getActiveEmbeddingContext,
  getCurrentModelInfo,
  initEmbedModel,
  initPipeline,
  logEmbed,
  reembedStaleEntities,
  runEmbeddingJob,
  runEmbeddingJobNow,
  switchEmbeddingModel,
} from './embedding';
