/**
 * @file index.ts
 * @description Export pure domain embedding model types and registry.
 * Adapter implementations (which require obsidian) are in ui/models/embed/adapters/.
 */

export { EmbedModel } from './EmbedModel';
export type { EmbedModelOptions } from './EmbedModel';
export { embedAdapterRegistry } from './registry';
export type { AdapterRegistration } from './registry';
