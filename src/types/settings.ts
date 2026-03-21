/**
 * @file settings.ts
 * @description Type definitions for plugin settings
 * All settings interfaces for the Smart Connections plugin
 */

/**
 * Embed model configuration
 */
export interface EmbedModelSettings {
  /** Adapter name (transformers, openai, ollama, gemini, etc.) */
  adapter: string;

  /** Transformers-specific settings */
  transformers?: {
    legacy_transformers: boolean;
    model_key: string;
  };

  /** OpenAI-specific settings */
  openai?: {
    api_key?: string;
    model_key?: string;
    endpoint?: string;
  };

  /** Ollama-specific settings */
  ollama?: {
    model_key?: string;
    endpoint?: string;
  };

  /** Gemini-specific settings */
  gemini?: {
    api_key?: string;
    model_key?: string;
  };

  /** LM Studio settings */
  lm_studio?: {
    endpoint?: string;
    model_key?: string;
  };

  /** Upstage settings */
  upstage?: {
    api_key?: string;
    model_key?: string;
  };

  /** Open Router settings */
  open_router?: {
    api_key?: string;
    model_key?: string;
  };
}

/**
 * Search model configuration (optional).
 * When set, this model is used for search queries instead of the indexing model.
 * The adapter's API credentials are inherited from `embed_model`'s adapter config.
 */
export interface SearchModelSettings {
  /** Provider name (e.g., 'upstage', 'openai') */
  adapter: string;

  /** Model key within that provider (e.g., 'embedding-query') */
  model_key: string;
}

/**
 * Source (file) settings
 */
export interface SourceSettings {
  /** Minimum characters for a source to be embedded */
  min_chars: number;

  /** Embed model configuration */
  embed_model: EmbedModelSettings;

  /** Search model configuration (optional, defaults to indexing model) */
  search_model?: SearchModelSettings;

  /** Excluded headings (comma-separated) */
  excluded_headings: string;

  /** File exclusion patterns (comma-separated) */
  file_exclusions: string;

  /** Folder exclusion patterns (comma-separated) */
  folder_exclusions: string;
}

/**
 * Block settings
 */
export interface BlockSettings {
  /** Whether to embed blocks */
  embed_blocks: boolean;

  /** Minimum characters for a block to be embedded */
  min_chars: number;
}

/**
 * View filter settings
 */
export interface ViewFilterSettings {
  /** Whether to show expanded view */
  expanded_view: boolean;

  /** Whether to render markdown in results */
  render_markdown: boolean;

  /** Whether to show full file paths */
  show_full_path: boolean;
}

/**
 * Notice settings
 */
export interface SmartNoticesSettings {
  /** Muted notice keys */
  muted: Record<string, boolean>;
}

/**
 * Main plugin settings
 */
export interface PluginSettings {
  /** Version tracking */
  version: string;

  /** Language setting */
  language: string;

  /** Whether this is a new user (deprecated, use localStorage) */
  new_user: boolean;

  /** Re-import wait time in seconds */
  re_import_wait_time: number;

  /** How often to save embedding progress (in batches). Lower = safer on crash, higher = less I/O */
  embed_save_interval: number;

  /** Whether this is an Obsidian vault */
  is_obsidian_vault: boolean;

  /** Source (file) settings */
  smart_sources: SourceSettings;

  /** Block settings */
  smart_blocks: BlockSettings;

  /** View filter settings */
  smart_view_filter: ViewFilterSettings;

  /** Smart notices settings */
  smart_notices: SmartNoticesSettings;
}
