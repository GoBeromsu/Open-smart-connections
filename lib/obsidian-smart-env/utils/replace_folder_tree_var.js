import { build_file_tree_string } from 'smart-utils/file_tree.js';

export function replace_folder_tree_var(prompt) {
  const env = this;
  let paths = env.smart_sources?.fs?.folder_paths ?? [];
  paths = paths.map(p => p.endsWith('/') ? p : p + '/'); // Ensure all paths end with a slash
  const tree = build_file_tree_string([...new Set(paths)]);
  return prompt.replace(/{{\s*folder_tree\s*}}/gi, tree);
}
