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
  enable_chat: false,

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

  smart_chat_threads: {
    chat_model: {
      adapter: 'ollama',
      ollama: {},
    },
  },

  smart_notices: {
    muted: {},
  },

  storage_engine: 'pglite',
  storage_reset_on_upgrade: true,
  vector_search_mode: 'exact',
  storage_reset_applied_version: '',
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
 * Chat model adapter registry
 */
export const CHAT_MODEL_ADAPTERS = {
  anthropic: 'SmartChatModelAnthropicAdapter',
  azure: 'SmartChatModelAzureAdapter',
  custom: 'SmartChatModelCustomAdapter',
  google: 'SmartChatModelGoogleAdapter',
  gemini: 'SmartChatModelGeminiAdapter',
  groq: 'SmartChatModelGroqAdapter',
  lm_studio: 'SmartChatModelLmStudioAdapter',
  ollama: 'SmartChatModelOllamaAdapter',
  open_router: 'SmartChatModelOpenRouterAdapter',
  openai: 'SmartChatModelOpenaiAdapter',
  xai: 'SmartChatModelXaiAdapter',
  deepseek: 'SmartChatModelDeepseekAdapter',
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
