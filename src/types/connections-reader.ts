import type { ParsedEmbedRuntimeState, EmbedStatePhase } from './embed-runtime';
import type { ConnectionResult } from './entities';
import type { EmbeddingBlockLike, EmbeddingSourceLike } from './obsidian-shims';

export interface ConnectionsReader {
  isReady(): boolean;
  isEmbedReady(): boolean;
  getStatusState(): string;
  hasPendingReImport(path: string): boolean;
  getBlocksForSource(path: string): EmbeddingBlockLike[];
  getSource(path: string): EmbeddingSourceLike | null;
  ensureBlocksForSource(path: string): Promise<readonly EmbeddingBlockLike[]>;
  getConnectionsForSource(path: string, limit?: number): Promise<readonly ConnectionResult[]>;
  getEmbedRuntimeState(): ParsedEmbedRuntimeState | null;
  getSearchModelFingerprint(): string | null;
  getKernelPhase(): EmbedStatePhase;
  isDiscovering(): boolean;
}
