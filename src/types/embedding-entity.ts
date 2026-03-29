/**
 * @file embedding-entity.ts
 * @description Runtime entity interfaces for embedding-aware objects.
 */

import type { ConnectionResult, EntityData, EmbeddingModelMeta } from './entity-data';
import type { SearchFilter } from './search-filter';

export interface EmbeddingEntity {
  key: string;
  data: EntityData;
  vec: number[] | Float32Array | null;
  active_embedding_meta?: EmbeddingModelMeta;
  tokens?: number;
  _queue_embed?: boolean;
  _embed_input?: string | null;
  get_embed_input(content?: string | null): Promise<void>;
  queue_embed(): void;
  nearest(filter?: SearchFilter): Promise<ConnectionResult[]>;
  has_embed(): boolean;
  is_unembedded: boolean;
  set_active_embedding_meta(meta: EmbeddingModelMeta): void;
  evictVec?(): void;
  should_embed: boolean;
}
