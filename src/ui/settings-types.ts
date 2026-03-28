import type { App, EventRef, Plugin } from 'obsidian';

import type { PluginSettings } from '../types/settings';

export interface SmartConnectionsPlugin extends Plugin {
  settings?: PluginSettings;
  saveSettings?: () => Promise<void>;
  embed_model?: unknown;
  source_collection?: { size?: number };
  block_collection?: { embeddedSourceCount?: number };
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
  refreshStatus?: () => void;
  getActiveEmbeddingContext?: () => {
    runId: number;
    current: number;
    total: number;
    startedAt?: number;
    currentEntityKey?: string | null;
    currentSourcePath?: string | null;
  } | null;
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
