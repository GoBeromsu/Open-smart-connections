/**
 * @file mcp-context.ts
 * @description Abstraction for MCP tool execution context.
 *
 * Both the Obsidian plugin (in-process) and a standalone process (reading
 * SQLite + filesystem directly) implement this interface. The MCP dispatch
 * layer programs against McpContext only — no Obsidian imports required.
 */

import type { ParsedEmbedRuntimeState } from './embed-runtime';

// ---------------------------------------------------------------------------
// Search result shape returned by query / connections tools
// ---------------------------------------------------------------------------

/** A single search result surfaced by MCP query or connections tools. */
export interface McpSearchResult {
  /** Vault-relative file path of the source note. */
  path: string;

  /** Cosine-similarity score (higher = more relevant). */
  score: number;

  /** Block key (e.g. "note.md#heading-1"). */
  blockKey: string;

  /** Heading breadcrumb trail for the matched block. */
  headings: string[];

  /** Truncated text preview of the matched block (max ~400 chars). */
  preview: string;
}

// ---------------------------------------------------------------------------
// Collection statistics
// ---------------------------------------------------------------------------

/** Aggregate counts for the status tool. */
export interface McpCollectionStats {
  sourceCount: number;
  embeddedSourceCount: number;
  blockCount: number;
  embeddedBlockCount: number;
}

// ---------------------------------------------------------------------------
// Model information
// ---------------------------------------------------------------------------

/** Minimal model info surfaced by the status tool. */
export interface McpModelInfo {
  adapter: string;
  modelKey: string;
  dims: number | null;
}

// ---------------------------------------------------------------------------
// MCP execution context
// ---------------------------------------------------------------------------

/**
 * Abstraction over the runtime that satisfies all five MCP tools
 * (query, connections, get, multi_get, status).
 *
 * **Plugin mode** — implemented by wrapping the live plugin instance
 * (Obsidian vault API, in-memory collections, loaded embed adapter).
 *
 * **Standalone mode** — implemented by reading the SQLite file directly,
 * using `fs` for note content, and loading a model for query embedding.
 */
export interface McpContext {
  // -- readiness flags -------------------------------------------------------

  /** Whether core data (collections) is loaded and ready. */
  readonly ready: boolean;

  /** Whether the embedding model is available for query embedding. */
  readonly embedReady: boolean;

  /** High-level status of the embedding subsystem. */
  readonly statusState: 'idle' | 'embedding' | 'error';

  /** Optional parsed runtime state for richer status reporting. */
  getRuntimeState?(): ParsedEmbedRuntimeState;

  /** Plugin / server version string (surfaced in initialize response). */
  readonly version: string;

  // -- note I/O --------------------------------------------------------------

  /**
   * Read the full markdown content of a note by vault-relative path.
   * Returns `null` when the file does not exist.
   */
  readNote(path: string): Promise<string | null>;

  /**
   * Check whether a note exists at the given vault-relative path.
   */
  noteExists(path: string): boolean;

  // -- embedding & search ----------------------------------------------------

  /**
   * Embed a natural-language query string into a vector.
   * Throws when the embedding model is unavailable.
   */
  embedQuery(query: string): Promise<number[]>;

  /**
   * Return the nearest block-level matches for a vector.
   *
   * @param vec     - Query vector (dense float array).
   * @param opts    - `limit`: max results; `exclude`: block keys to skip.
   */
  searchNearest(
    vec: number[] | Float32Array,
    opts: { limit: number; exclude?: string[] },
  ): Promise<McpSearchResult[]>;

  /**
   * Return semantically related notes for a given file path.
   * Internally averages the file's block vectors and searches.
   */
  getConnections(filePath: string, limit: number): Promise<McpSearchResult[]>;

  // -- metadata --------------------------------------------------------------

  /** Current embedding model information. */
  getModelInfo(): McpModelInfo;

  /** Aggregate collection counts. */
  getStats(): McpCollectionStats;

  // -- logging ---------------------------------------------------------------

  /** Logger for warnings (errors are thrown or returned as tool results). */
  readonly logger: McpContextLogger;
}

// ---------------------------------------------------------------------------
// Logger contract
// ---------------------------------------------------------------------------

/** Minimal logger interface — both PluginLogger and console satisfy this. */
export interface McpContextLogger {
  warn(message: string, extra?: unknown): void;
}
