import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EmbeddingModelMeta, SearchFilter } from '../../types/entities';
import type { QueryMatch } from './node-sqlite-types';

export interface EntityDataAdapter<T extends EmbeddingEntity> {
  initVaultContext(vaultAdapter: unknown, configDir: string, pluginId: string): void | Promise<void>;
  initDbPath?(absoluteDbPath: string): void | Promise<void>;
  close(): void;
  load(): void | Promise<void>;
  rebuildVectorIndex(): void;
  save(): Promise<void>;
  save_batch(entities: T[], deletedKeys?: string[]): Promise<void>;
  load_entity_vector(
    entityKey: string,
    modelKey: string,
  ): Promise<{ vec: Float32Array | null; tokens?: number; meta?: EmbeddingModelMeta }>;
  query_nearest(
    vec: number[] | Float32Array,
    filter?: SearchFilter,
    fetchMultiplier?: number,
  ): Promise<QueryMatch[]>;
}
