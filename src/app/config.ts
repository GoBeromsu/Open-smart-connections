/**
 * @file config.ts
 * @description Hand-written configuration for Smart Connections plugin
 * No auto-scanner - explicit configuration only
 */

import type { PluginSettings } from '../shared/types/settings';

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  version: '',
  language: 'en',
  new_user: true,
  re_import_wait_time: 13,
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

/**
 * Collection references for Smart Environment
 */
export const COLLECTIONS = {
  smart_sources: 'SmartSources',
  smart_blocks: 'SmartBlocks',
};

/**
 * Embed model adapter registry
 */
export const EMBED_MODEL_ADAPTERS = {
  transformers: 'SmartEmbedTransformersIframeAdapter',
  openai: 'SmartEmbedOpenAIAdapter',
  ollama: 'SmartEmbedOllamaAdapter',
  gemini: 'GeminiEmbedModelAdapter',
  lm_studio: 'LmStudioEmbedModelAdapter',
  upstage: 'SmartEmbedUpstageAdapter',
  open_router: 'SmartEmbedOpenRouterAdapter',
};

/**
 * Source content adapter registry by file extension
 */
export const SOURCE_ADAPTERS = {
  md: 'ObsidianMarkdownSourceContentAdapter',
  txt: 'ObsidianMarkdownSourceContentAdapter',
  'excalidraw.md': 'ExcalidrawSourceContentAdapter',
  base: 'BasesSourceContentAdapter',
};

/**
 * Block content adapter registry by file extension
 */
export const BLOCK_ADAPTERS = {
  md: 'MarkdownBlockContentAdapter',
  txt: 'MarkdownBlockContentAdapter',
  'excalidraw.md': 'MarkdownBlockContentAdapter',
};
