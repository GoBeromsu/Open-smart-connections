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
 * Chat model configuration
 */
export interface ChatModelSettings {
  /** Adapter name (openai, anthropic, ollama, google, etc.) */
  adapter: string;

  /** OpenAI-specific settings */
  openai?: {
    api_key?: string;
    model_key?: string;
    endpoint?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Anthropic-specific settings */
  anthropic?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Ollama-specific settings */
  ollama?: {
    model_key?: string;
    endpoint?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Google-specific settings */
  google?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Gemini-specific settings */
  gemini?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Azure-specific settings */
  azure?: {
    api_key?: string;
    deployment_id?: string;
    endpoint?: string;
    api_version?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Groq-specific settings */
  groq?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** LM Studio settings */
  lm_studio?: {
    endpoint?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Open Router settings */
  open_router?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** XAI settings */
  xai?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Deepseek settings */
  deepseek?: {
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
  };

  /** Custom adapter settings */
  custom?: {
    endpoint?: string;
    api_key?: string;
    model_key?: string;
    max_tokens?: number;
    temperature?: number;
    headers?: Record<string, string>;
  };
}

/**
 * Source (file) settings
 */
export interface SourceSettings {
  /** Minimum characters for a source to be embedded */
  min_chars: number;

  /** Embed model configuration */
  embed_model: EmbedModelSettings;

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
 * Chat settings
 */
export interface ChatSettings {
  /** Chat model configuration */
  chat_model: ChatModelSettings;

  /** Context token budget */
  context_max_tokens?: number;

  /** Context strategies to use */
  context_strategies?: string[];
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

  /** Whether this is an Obsidian vault */
  is_obsidian_vault: boolean;

  /** Enable chat feature (beta, default false) */
  enable_chat?: boolean;

  /** Source (file) settings */
  smart_sources: SourceSettings;

  /** Block settings */
  smart_blocks: BlockSettings;

  /** View filter settings */
  smart_view_filter: ViewFilterSettings;

  /** Chat thread settings */
  smart_chat_threads: ChatSettings;

  /** Smart notices settings */
  smart_notices: SmartNoticesSettings;

  /** Storage engine for embeddings */
  storage_engine: 'pglite';

  /** Reset persisted storage on plugin upgrade */
  storage_reset_on_upgrade: boolean;

  /** Embedding vector search mode */
  vector_search_mode: 'exact';

  /** Last plugin version that completed storage reset */
  storage_reset_applied_version?: string;
}
