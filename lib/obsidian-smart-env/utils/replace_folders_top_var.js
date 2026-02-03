import { build_file_tree_string } from 'smart-utils/file_tree.js';

export function replace_folders_top_var(prompt) {
  const env = this;
  let paths = env.smart_sources?.fs?.folder_paths ?? [];
  paths = paths.map(p => (p.split('/')[0] || '') + '/');
  const tree = build_file_tree_string([...new Set(paths)]);
  return prompt.replace(/{{\s*folders_top\s*}}/gi, tree);
}
