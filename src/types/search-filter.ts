/**
 * @file search-filter.ts
 * @description Search and nearest-neighbor filter shapes.
 */

export interface SearchFilter {
  limit?: number;
  min_score?: number;
  exclude?: string[];
  include?: string[];
  key_starts_with?: string;
  key_does_not_start_with?: string;
  filter_fn?: (item: unknown) => boolean;
}
