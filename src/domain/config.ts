/**
 * @file config.ts
 * @description Domain constants for Open Connections plugin:
 *   - TransientError, FatalError: typed error classes for embedding API error classification
 *   - DEFAULT_SETTINGS: hand-written plugin defaults (no auto-scanner)
 *   - NOTICE_CATALOG: all notice definitions + SmartConnectionsNotices alias
 */

import type { PluginSettings, NoticeCatalog } from '../types/settings';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Transient errors are retryable: 429 (rate limit), 503 (service unavailable),
 * network timeouts, connection refused, etc.
 */
export class TransientError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    opts?: { retryAfterMs?: number },
  ) {
    super(message);
    this.name = 'TransientError';
    this.status = status;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

/**
 * Fatal errors are NOT retryable: 400 (bad request), 401 (unauthorized),
 * 403 (forbidden), malformed response, etc.
 */
export class FatalError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FatalError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  version: '',
  language: 'en',
  new_user: true,
  re_import_wait_time: 13,
  embed_save_interval: 5,
  embed_concurrency: 5,
  discovery_chunk_size: 1000,
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
    block_heading_depth: 3,
  },

  smart_view_filter: {
    expanded_view: false,
    render_markdown: true,
    show_full_path: false,
    highlight_threshold: 0.8,
  },

  smart_notices: {
    muted: {},
  },
};

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export const NOTICE_CATALOG: NoticeCatalog = {
  notice_muted: {
    template: 'Notice muted. Undo in settings.',
    timeout: 2000,
    immutable: true,
  },
  embedding_progress: {
    template: '{{adapter}}/{{modelKey}} {{current}}/{{total}} ({{percent}}%)',
    timeout: 0,
  },
  embedding_complete: {
    template: 'Embedding complete! {{success}} notes embedded.',
  },
  embedding_failed: {
    template: 'Embedding failed. See console for details.',
  },
  embedding_provider_limited: {
    template: 'Embedding stopped: {{adapter}}/{{modelKey}} hit the provider request limit. Wait and retry later, raise API quota, or switch to a local model.',
    timeout: 10000,
  },
  failed_init_embed_model: {
    template: 'Failed to initialize embedding model',
  },
  failed_download_transformers_model: {
    template: 'Failed to download transformers model assets. Check network/CDN access and retry.',
  },
  failed_download_timeout: {
    template: 'Model download timed out. Try a smaller model or increase timeout in settings.',
  },
  failed_download_quota: {
    template: 'Browser storage quota exceeded. Clear IndexedDB in DevTools → Application → Storage and retry.',
  },
  failed_download_network: {
    template: 'Failed to download model files. Check your network connection and retry.',
  },
  failed_download_model_not_found: {
    template: 'Model "{{modelKey}}" not found. Try switching to BGE-micro-v2 (recommended).',
  },
  failed_init_embed_pipeline: {
    template: 'Failed to initialize embedding pipeline',
  },
  failed_load_collection_data: {
    template: 'Failed to load collection data',
  },
  reimport_failed: {
    template: 'Re-import failed. See console for details.',
  },
  no_stale_entities: {
    template: 'No stale entities to re-embed.',
  },
  reinitializing_embedding_model: {
    template: 'Re-initializing embedding model...',
  },
  embedding_model_switched: {
    template: 'Embedding model switched.',
  },
  failed_reinitialize_model: {
    template: 'Failed to re-initialize model. Check console.',
  },
};

export type { NoticeCatalog };
