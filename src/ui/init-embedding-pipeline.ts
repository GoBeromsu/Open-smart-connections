import type SmartConnectionsPlugin from '../main';
import { EmbeddingPipeline } from '../domain/embedding-pipeline';

export function initPipeline(plugin: SmartConnectionsPlugin): void {
  if (!plugin.embed_adapter) {
    plugin.notices.show('failed_init_embed_pipeline');
    throw new Error('Embed adapter must be initialized before pipeline');
  }

  plugin.embedding_pipeline = new EmbeddingPipeline(plugin.embed_adapter);
  plugin.logger.debug('[SC][Init]   [pipeline] Embedding pipeline initialized');
}
