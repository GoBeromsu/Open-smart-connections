import type { App, EventRef, Plugin } from 'obsidian';

import type { EmbeddingKernelJob } from '../domain/embedding-kernel-types';
import type { ParsedEmbedRuntimeState } from '../types/embed-runtime';
import type { PluginSettings } from '../types/settings';

export interface SmartConnectionsPlugin extends Plugin {
  settings?: PluginSettings;
  saveSettings?: () => Promise<void>;
  embed_model?: unknown;
  source_collection?: {
    size?: number;
    all?: Array<{ key: string }>;
    data_adapter?: { save: () => Promise<void> };
    recomputeEmbeddedCount?: () => void;
  };
  block_collection?: {
    embeddedSourceCount?: number;
    embeddedCount?: number;
    effectiveTotal?: number;
    data_adapter?: { save: () => Promise<void> };
    recomputeEmbeddedCount?: () => void;
  };
  embed_ready?: boolean;
  ready?: boolean;
  status_state?: 'idle' | 'embedding' | 'error';
  embedding_pipeline?: unknown;
  current_embed_context?: {
    runId: number;
    current: number;
    total: number;
    currentSourcePath?: string | null;
    currentEntityKey?: string | null;
  } | null;
  switchEmbeddingModel?: (reason?: string) => Promise<void>;
  reembedStaleEntities?: (reason?: string) => Promise<number>;
  processNewSourcesChunked?: () => Promise<void>;
  queueSourceReImport?: (path: string) => void;
  removeSource?: (path: string) => void;
  applyExcludedFolder?: (folderPath: string) => Promise<void>;
  removeExcludedFolder?: (folderPath: string) => Promise<void>;
  enqueueEmbeddingJob?: <T = unknown>(job: EmbeddingKernelJob<T>) => Promise<T>;
  refreshStatus?: () => void;
  logger?: { info: (message: string) => void };
  getMcpServer?: () => { isRunning: boolean; endpointUrl: string };
  syncMcpServer?: () => Promise<void>;
  getActiveEmbeddingContext?: () => {
    runId: number;
    current: number;
    total: number;
    startedAt?: number;
    currentEntityKey?: string | null;
    currentSourcePath?: string | null;
  } | null;
  getEmbedRuntimeState?: () => ParsedEmbedRuntimeState;
  notices?: {
    show?: (id: string, params?: Record<string, unknown>, opts?: Record<string, unknown>) => unknown;
    listMuted?: () => string[];
    unmute?: (id: string) => Promise<void>;
    unmuteAll?: () => Promise<void>;
  };
}

export interface SettingsConfigAccessor {
  getConfig<T>(path: string, fallback: T): T;
  setConfig(path: string, value: unknown): void;
}

export interface EmbeddingStatusElements {
  eventRefs: EventRef[];
  statusRowEl: HTMLElement | null;
  statsGridEl: HTMLElement | null;
  currentRunEl: HTMLElement | null;
  currentRunSettingEl: HTMLElement | null;
  embedProgress: { update(): void; destroy(): void } | null;
}

export interface SettingsTabDeps {
  app: App;
  plugin: SmartConnectionsPlugin;
  display: () => void;
  config: SettingsConfigAccessor;
}
