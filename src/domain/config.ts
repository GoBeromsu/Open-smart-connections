/**
 * @file config.ts
 * @description Hand-written configuration for Smart Connections plugin
 * No auto-scanner - explicit configuration only
 */

import type { PluginSettings } from '../types/settings';

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  version: '',
  language: 'en',
  new_user: true,
  re_import_wait_time: 13,
  embed_save_interval: 5,
  is_obsidian_vault: true,

  smart_sources: {
    min_chars: 200,
    embed_model: {
      adapter: 'transformers',
      transformers: {
        legacy_transformers: false,
        model_key: 'TaylorAI/bge-micro-v2',
      },
    },
    excluded_headings: '',
    file_exclusions: 'Untitled',
    folder_exclusions: '',
  },

  smart_blocks: {
    embed_blocks: true,
    min_chars: 200,
  },

  smart_view_filter: {
    expanded_view: false,
    render_markdown: true,
    show_full_path: false,
  },

  smart_notices: {
    muted: {},
  },
};

