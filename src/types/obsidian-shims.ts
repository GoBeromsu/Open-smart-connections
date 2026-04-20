/**
 * @file obsidian-shims.ts
 * @description Minimal structural shims for Obsidian types used in domain/ layer.
 *
 * The domain/ layer must NOT import from 'obsidian'. These interfaces are
 * structurally compatible with Obsidian's real types — the composition root
 * (src/main.ts) passes real Obsidian objects which satisfy these interfaces
 * via TypeScript structural typing.
 */

/** Subset of Obsidian's FileStats used by domain entities */
export interface FileStat {
  ctime: number;
  mtime: number;
  size: number;
}

/** Subset of Obsidian's TFile used by domain entities */
export interface TFileShim {
  path: string;
  basename: string;
  extension: string;
  stat: FileStat;
  name: string;
  parent: { path: string } | null;
}

/** Subset of Obsidian's Vault used by domain entities */
export interface VaultShim {
  getMarkdownFiles(): TFileShim[];
  cachedRead(file: TFileShim): Promise<string>;
  getAbstractFileByPath(path: string): TFileShim | null;
}

/** Subset of Obsidian's HeadingCache used by domain entities */
export interface HeadingCacheShim {
  heading: string;
  level: number;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/** Subset of Obsidian's LinkCache used by domain entities */
export interface LinkCacheShim {
  link: string;
  original: string;
  displayText?: string;
  position?: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/** Subset of Obsidian's CachedMetadata used by domain entities */
export interface CachedMetadataShim {
  headings?: HeadingCacheShim[];
  links?: LinkCacheShim[];
  frontmatter?: Record<string, unknown>;
  sections?: Array<{
    type: string;
    position: {
      start: { line: number; col: number; offset: number };
      end: { line: number; col: number; offset: number };
    };
  }>;
}

/** Subset of Obsidian's MetadataCache used by domain entities */
export interface MetadataCacheShim {
  getFileCache(file: TFileShim): CachedMetadataShim | null;
}

export interface EmbeddingBlockLike {
  has_embed(): boolean;
  key?: string;
  source_key?: string;
  queue_embed?(): void;
}

export interface EmbeddingSourceLike {
  key: string;
  path: string;
  file?: TFileShim;
  vault?: VaultShim;
  cached_metadata?: CachedMetadataShim;
  read?(): Promise<string>;
}
