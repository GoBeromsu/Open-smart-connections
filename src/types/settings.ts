/**
 * @file settings.ts
 * @description Type definitions for plugin settings
 * All settings interfaces for the Open Connections plugin
 */

/**
 * Embed model configuration
 */
export interface EmbedModelSettings {
  /** Allow dynamic adapter sub-key access (e.g., embedSettings[adapterType]) */
  [key: string]: unknown;

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
  [key: string]: unknown;
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
  [key: string]: unknown;
  /** Whether to embed blocks */
  embed_blocks: boolean;

  /** Minimum characters for a block to be embedded */
  min_chars: number;

  /** Maximum heading level to split blocks at (1-6). H1..H<depth> create new blocks; deeper headings merge into parent. */
  block_heading_depth: number;
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
 * Notice catalog types (mirrors shared/plugin-notices, without the Obsidian import)
 */
export interface NoticeDefinition {
  template: string;
  timeout?: number;
  immutable?: boolean;
}

export type NoticeCatalog = Record<string, NoticeDefinition>;

/**
 * Notice settings
 */
export interface SmartNoticesSettings {
  [key: string]: unknown;
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

  /** Number of batches sent to the API simultaneously (1-10, default 5) */
  embed_concurrency: number;

  /** Files per discovery chunk (10-200, default 50). Lower = smoother UI, higher = faster discovery */
  discovery_chunk_size: number;

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
