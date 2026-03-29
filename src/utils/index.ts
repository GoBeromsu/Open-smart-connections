/**
 * @file index.ts
 * @description Barrel exports for focused utility modules.
 */

export { average_vectors } from './average-vectors';
export { cos_sim, cos_sim_f32 } from './cos-sim';
export { create_hash } from './create-hash';
export { determine_installed_at } from './determine-installed-at';
export { errorMessage } from './error-message';
export { DEFAULT_EXCLUDED_FOLDERS, isExcludedPath } from './path-exclusions';
export { processInChunks } from './process-in-chunks';
export {
  results_acc,
  type ResultsAccumulator,
  type ScoredResult,
} from './results-accumulator';
export { sort_by_score_ascending, sort_by_score_descending } from './sort-by-score';
