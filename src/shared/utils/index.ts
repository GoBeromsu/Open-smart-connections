/**
 * @file index.ts
 * @description Barrel exports for all utility functions
 */

export { cos_sim } from './cos_sim';
export {
  create_hash,
  murmur_hash_32,
  murmur_hash_32_alphanumeric,
  fnv1a_32,
  fnv1a_32_alphanumeric,
} from './create_hash';
export {
  results_acc,
  furthest_acc,
  type ScoredResult,
  type ResultsAccumulator,
  type FurthestAccumulator,
} from './results_acc';
export {
  sort_by_score,
  sort_by_score_descending,
  sort_by_score_ascending,
} from './sort_by_score';
export { compute_centroid, compute_medoid } from './geom';
export { deep_merge } from './deep_merge';
export {
  sequential_async_processor,
  type AsyncProcessorFn,
} from './sequential_async_processor';
export {
  parse_xml_fragments,
  type XmlNode,
} from './parse_xml_fragments';
export {
  insert_text_in_chunks,
  split_into_chunks,
  text_to_nodes,
  type InsertChunksOptions,
} from './insert_text_in_chunks';
export { sim_hash, type SimHashOptions } from './sim_hash';
