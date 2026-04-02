import type SmartConnectionsPlugin from '../main';
import type { ConnectionResult, SearchFilter } from '../types/entities';
import { searchNearestAcrossCollections } from '../domain/semantic-search';
import type { LookupFilter } from './lookup-view-format';

type SearchableCollection = {
  all: unknown[];
  nearest: (vec: number[], filter: SearchFilter) => Promise<ConnectionResult[]>;
};

export function getActiveCollections(
  plugin: SmartConnectionsPlugin,
  activeFilter: LookupFilter,
): SearchableCollection[] {
  const collections: SearchableCollection[] = [];
  if (activeFilter !== 'blocks' && plugin.source_collection) {
    collections.push(plugin.source_collection as SearchableCollection);
  }
  if (activeFilter !== 'notes' && plugin.block_collection) {
    collections.push(plugin.block_collection as SearchableCollection);
  }
  return collections;
}

export function getLookupEntityCount(
  plugin: SmartConnectionsPlugin,
  activeFilter: LookupFilter,
): number {
  return getActiveCollections(plugin, activeFilter).reduce(
    (count, collection) => count + collection.all.length,
    0,
  );
}

export async function searchCollections(
  plugin: SmartConnectionsPlugin,
  activeFilter: LookupFilter,
  queryVec: number[],
  limit: number,
): Promise<ConnectionResult[]> {
  const collections = getActiveCollections(plugin, activeFilter);
  return await searchNearestAcrossCollections(collections, queryVec, limit);
}
