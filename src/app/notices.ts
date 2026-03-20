/**
 * @file notices.ts
 * @description Notice catalog and re-export of shared PluginNotices for Smart Connections
 */

import { PluginNotices, type NoticeCatalog } from '../shared/plugin-notices';

export const NOTICE_CATALOG: NoticeCatalog = {
  notice_muted: {
    template: 'Notice muted. Undo in settings.',
    timeout: 2000,
    immutable: true,
  },
  embedding_progress: {
    template: '{{adapter}}/{{modelKey}} {{current}}/{{total}} ({{percent}}%)',
    timeout: 0,
  },
  embedding_complete: {
    template: 'Embedding complete! {{success}} notes embedded.',
  },
  embedding_failed: {
    template: 'Embedding failed. See console for details.',
  },
  failed_init_embed_model: {
    template: 'Failed to initialize embedding model',
  },
  failed_download_transformers_model: {
    template: 'Failed to download transformers model assets. Check network/CDN access and retry.',
  },
  failed_init_embed_pipeline: {
    template: 'Failed to initialize embedding pipeline',
  },
  failed_load_collection_data: {
    template: 'Failed to load collection data',
  },
  reimport_failed: {
    template: 'Re-import failed. See console for details.',
  },
  update_available: {
    template: 'Update available ({{tag_name}})',
  },
  no_stale_entities: {
    template: 'No stale entities to re-embed.',
  },
  reinitializing_embedding_model: {
    template: 'Re-initializing embedding model...',
  },
  embedding_model_switched: {
    template: 'Embedding model switched.',
  },
  failed_reinitialize_model: {
    template: 'Failed to re-initialize model. Check console.',
  },
};

export { PluginNotices as SmartConnectionsNotices };
export type { NoticeCatalog };
