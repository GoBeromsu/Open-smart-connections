// Stub file for smart-plugins-obsidian utilities
// These functions are not used in the core plugin but are required for build

export function get_smart_server_url() {
  return 'https://smartconnections.app';
}

export async function fetch_plugin_zip(repo, token) {
  throw new Error('smart-plugins-obsidian: fetch_plugin_zip not implemented');
}

export async function parse_zip_into_files(zipData) {
  throw new Error('smart-plugins-obsidian: parse_zip_into_files not implemented');
}

export async function write_files_with_adapter(adapter, baseFolder, files) {
  throw new Error('smart-plugins-obsidian: write_files_with_adapter not implemented');
}

export async function enable_plugin(app, folderName) {
  throw new Error('smart-plugins-obsidian: enable_plugin not implemented');
}
