import { smart_completions_default_config as smart_completions } from 'smart-completions';
import { replace_folder_tree_var } from './replace_folder_tree_var.js';
import { replace_folders_top_var } from './replace_folders_top_var.js';
import { replace_recent_n_var } from './replace_recent_n_var.js';
import { replace_vault_tags_var } from './replace_vault_tags_var.js';

export function register_completion_variable_adapter_replacements(variable_adapter_class) {
  variable_adapter_class.register(
    txt => /{{\s*folder_tree\s*}}/i.test(txt),
    replace_folder_tree_var,
    "{{ folder_tree }}" // Example variable
  );
  variable_adapter_class.register(
    txt => /{{\s*folders_top\s*}}/i.test(txt),
    replace_folders_top_var,
    "{{ folders_top }}" // Example variable
  );
  variable_adapter_class.register(
    txt => /{{\s*(?:tags|vault_tags)\s*}}/i.test(txt),
    replace_vault_tags_var,
    "{{ tags }}" // Example variable
  );
  variable_adapter_class.register(
    txt => /{{\s*recent_(\d+)\s*}}/i.test(txt),
    replace_recent_n_var,
    "{{ recent_10 }}" // Example variable
  );
}