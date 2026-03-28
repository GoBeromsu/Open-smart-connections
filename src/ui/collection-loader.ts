/**
 * @file collection-loader.ts
 * @description Facade exports for collection initialization and loading helpers.
 */

export { syncCollectionEmbeddingContext, getEmbedAdapterSettings, resolveStorageNamespace } from './collection-embed-context';
export { initCollections } from './collection-init';
export { loadCollections, detectStaleSourcesOnStartup } from './collection-load';
export { processNewSourcesChunked, queueUnembeddedEntities } from './collection-processing';
