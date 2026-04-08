/**
 * @file main.ts
 * @description Composition root for Open Connections.
 */

import { Plugin, TFile } from 'obsidian';
import type { EmbedModelAdapter } from './types/models';
import type { EmbedQueueStats, EmbeddingPipeline } from './domain/embedding-pipeline';
import type { BlockCollection, SourceCollection } from './domain/entities';
import type { EmbeddingKernelJob } from './domain/embedding-kernel-types';
import type { PluginSettings } from './types/settings';
import type {
  EmbedProgressEventPayload,
  EmbedStatePhase,
  EmbedStateSnapshot,
  EmbeddingRunContext,
  ParsedEmbedRuntimeState,
} from './types/embed-runtime';
import { isEmbedModelReady, parseEmbedRuntimeState, toLegacyStatusState } from './types/embed-runtime';
import { NOTICE_CATALOG } from './domain/config';
import { EmbeddingKernelJobQueue } from './domain/embedding/kernel';
import { PluginLogger } from './shared/plugin-logger';
import { PluginNotices as SmartConnectionsNotices } from './shared/plugin-notices';
import {
  detectStaleSourcesOnStartup as _detectStaleSourcesOnStartup,
  getEmbedAdapterSettings as _getEmbedAdapterSettings,
  initCollections as _initCollections,
  loadCollections as _loadCollections,
  processNewSourcesChunked as _processNewSourcesChunked,
  queueUnembeddedEntities as _queueUnembeddedEntities,
  syncCollectionEmbeddingContext as _syncCollectionEmbeddingContext,
} from './ui/collection-loader';
import {
  clearEmbedNotice as _clearEmbedNotice,
  getActiveEmbeddingContext as _getActiveEmbeddingContext,
  getCurrentModelInfo as _getCurrentModelInfo,
  initEmbedModel as _initEmbedModel,
  initPipeline as _initPipeline,
  logEmbed as _logEmbed,
  reembedStaleEntities as _reembedStaleEntities,
  runEmbeddingJob as _runEmbeddingJob,
  switchEmbeddingModel as _switchEmbeddingModel,
} from './ui/embed-orchestrator';
import {
  debounceReImport as _debounceReImport,
  isSourceFile as _isSourceFile,
  queueSourceReImport as _queueSourceReImport,
  registerFileWatchers as _registerFileWatchers,
  removeSource as _removeSource,
  runReImport as _runReImport,
} from './ui/file-watcher';
import {
  initializeCore as _initializeCore,
  initializeEmbedding as _initializeEmbedding,
  initializePlugin as _initializePlugin,
  obsidianIsSyncing as _obsidianIsSyncing,
  waitForSync as _waitForSync,
} from './ui/plugin-initialization';
import {
  resetEmbedError as _resetEmbedError,
  setEmbedPhase as _setEmbedPhase,
} from './ui/plugin-lifecycle';
import { onPluginLoad } from './ui/plugin-bootstrap';
import { cleanupPlugin } from './ui/plugin-cleanup';
import { openNote as _openNote } from './ui/plugin-navigation';
import { loadPluginSettings as _loadPluginSettings, savePluginSettings as _savePluginSettings } from './ui/plugin-settings-data';
import {
  addToGitignore as _addToGitignore,
  getDataJsonCreatedAt as _getDataJsonCreatedAt,
  getLastKnownVersion as _getLastKnownVersion,
  handleNewUser as _handleNewUser,
  isNewUser as _isNewUser,
  loadUserState as _loadUserState,
  migrateInstalledAtFromLocalStorage as _migrateInstalledAtFromLocalStorage,
  saveInstalledAt as _saveInstalledAt,
  setLastKnownVersion as _setLastKnownVersion,
} from './ui/user-state';
import {
  handleStatusBarClick as _handleStatusBarClick,
  refreshStatus as _refreshStatus,
  setupStatusBar as _setupStatusBar,
} from './ui/status-bar';
import { OpenConnectionsMcpServer } from './ui/mcp-server';

export default class SmartConnectionsPlugin extends Plugin {
  settings: PluginSettings;
  status_elm?: HTMLElement;
  status_container?: HTMLElement;
  status_msg?: HTMLElement;
  re_import_timeout?: number;
  _unloading = false;
  _installed_at: number | null = null;
  readonly logger = new PluginLogger('Open Connections');
  embed_adapter?: EmbedModelAdapter;
  _search_embed_model?: EmbedModelAdapter;
  source_collection?: SourceCollection;
  block_collection?: BlockCollection;
  embedding_pipeline?: EmbeddingPipeline;
  ready = false;
  init_errors: Array<{ phase: string; error: Error }> = [];
  embed_run_seq = 0;
  embed_notice_last_update = 0;
  embed_notice_last_percent = 0;
  current_embed_context: EmbeddingRunContext | null = null;
  embedding_job_queue?: EmbeddingKernelJobQueue;
  pendingReImportPaths = new Set<string>();
  mcp_server?: OpenConnectionsMcpServer;
  _lifecycle_epoch = 0;
  _embed_state: EmbedStateSnapshot = { phase: 'idle', modelFingerprint: null, lastError: null };
  _notices?: SmartConnectionsNotices;

  get notices(): SmartConnectionsNotices {
    if (!this._notices) {
      this._notices = new SmartConnectionsNotices(
        {
          settings: this.settings as unknown as Record<string, unknown>,
          saveSettings: () => this.saveSettings(),
        },
        NOTICE_CATALOG,
        'Open Connections',
      );
    }
    return this._notices;
  }

  get embed_ready(): boolean { return isEmbedModelReady(this.getEmbedRuntimeState()); }
  get search_embed_model(): EmbedModelAdapter | undefined { return this._search_embed_model ?? this.embed_adapter; }
  get status_state(): 'idle' | 'embedding' | 'error' { return toLegacyStatusState(this.getEmbedRuntimeState()); }
  getEmbedRuntimeState(): ParsedEmbedRuntimeState { return parseEmbedRuntimeState(this._embed_state, this.current_embed_context); }

  setEmbedPhase(phase: EmbedStatePhase, opts: { error?: string; fingerprint?: string } = {}): void { _setEmbedPhase(this, phase, opts); }
  resetError(): void { _resetEmbedError(this); }
  async onload(): Promise<void> { await onPluginLoad(this); }
  async initialize(lifecycle: number = this._lifecycle_epoch): Promise<void> { await _initializePlugin(this, lifecycle); }
  async initializeCore(lifecycle: number = this._lifecycle_epoch): Promise<void> { await _initializeCore(this, lifecycle); }
  async initializeEmbedding(lifecycle: number = this._lifecycle_epoch): Promise<void> { await _initializeEmbedding(this, lifecycle); }
  getActiveEmbeddingContext(): EmbeddingRunContext | null { return _getActiveEmbeddingContext(this); }
  getCurrentModelInfo(): { adapter: string; modelKey: string; dims: number | null } { return _getCurrentModelInfo(this); }
  logEmbed(event: string, context: Partial<EmbedProgressEventPayload> = {}): void { _logEmbed(this, event, context); }
  clearEmbedNotice(): void { _clearEmbedNotice(this); }
  async loadSettings(): Promise<void> { await _loadPluginSettings(this); }
  async saveSettings(): Promise<void> { await _savePluginSettings(this); }
  loadUserState(): Promise<void> { return _loadUserState(this); }
  getDataJsonCreatedAt(): Promise<number | null> { return _getDataJsonCreatedAt(this); }
  migrateInstalledAtFromLocalStorage(): boolean { return _migrateInstalledAtFromLocalStorage(this); }
  saveInstalledAt(value: number): Promise<void> { return _saveInstalledAt(this, value); }
  isNewUser(): boolean { return _isNewUser(this); }
  async waitForSync(): Promise<void> { await _waitForSync(this); }
  obsidianIsSyncing(): boolean { return _obsidianIsSyncing(this); }
  initEmbedModel(): Promise<void> { return _initEmbedModel(this); }
  initPipeline(): Promise<void> { _initPipeline(this); return Promise.resolve(); }
  syncCollectionEmbeddingContext(): void { _syncCollectionEmbeddingContext(this); }
  getEmbedAdapterSettings(embedSettings?: Record<string, unknown>): Record<string, unknown> { return _getEmbedAdapterSettings(embedSettings); }
  initCollections(): Promise<void> { return _initCollections(this); }
  loadCollections(): Promise<void> { return _loadCollections(this); }
  detectStaleSourcesOnStartup(): Promise<number> { return _detectStaleSourcesOnStartup(this); }
  processNewSourcesChunked(): Promise<void> { return _processNewSourcesChunked(this); }
  queueUnembeddedEntities(): number { return _queueUnembeddedEntities(this); }
  reembedStaleEntities(reason: string = 'Manual re-embed'): Promise<number> { return _reembedStaleEntities(this, reason); }
  switchEmbeddingModel(reason: string = 'Embedding model switch'): Promise<void> { return _switchEmbeddingModel(this, reason); }
  runEmbeddingJob(reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> { return _runEmbeddingJob(this, reason); }
  registerFileWatchers(): void { _registerFileWatchers(this); }
  isSourceFile(file: TFile): boolean { return _isSourceFile(file, this); }
  queueSourceReImport(path: string): void { _queueSourceReImport(this, path); }
  removeSource(path: string): void { _removeSource(this, path); }
  debounceReImport(): void { _debounceReImport(this); }
  runReImport(): Promise<void> { return _runReImport(this); }
  setupStatusBar(): void { _setupStatusBar(this); }
  refreshStatus(): void { _refreshStatus(this); }
  handleStatusBarClick(): void { _handleStatusBarClick(this); }
  handleNewUser(): Promise<void> { return _handleNewUser(this); }
  getLastKnownVersion(): Promise<string> { return _getLastKnownVersion(this); }
  setLastKnownVersion(version: string): Promise<void> { return _setLastKnownVersion(this, version); }
  addToGitignore(ignore: string, message: string | null = null): Promise<void> { return _addToGitignore(this, ignore, message); }
  getMcpServer(): OpenConnectionsMcpServer {
    if (!this.mcp_server) this.mcp_server = new OpenConnectionsMcpServer(this);
    return this.mcp_server;
  }
  async syncMcpServer(): Promise<void> { await this.getMcpServer().syncWithSettings(); }
  async startMcpServer(): Promise<void> {
    this.settings.mcp.enabled = true;
    await this.saveSettings();
    await this.getMcpServer().start();
  }
  async stopMcpServer(): Promise<void> {
    this.settings.mcp.enabled = false;
    await this.saveSettings();
    await this.getMcpServer().stop();
  }

  ensureEmbeddingKernel(): void {
    if (!this.embedding_job_queue) this.embedding_job_queue = new EmbeddingKernelJobQueue();
  }

  enqueueEmbeddingJob<T = unknown>(job: EmbeddingKernelJob<T>): Promise<T> {
    this.ensureEmbeddingKernel();
    return this.embedding_job_queue!.enqueue(job);
  }

  async open_note(targetPath: string, event: MouseEvent | null = null): Promise<void> { await _openNote(this, targetPath, event); }
  onunload(): void { cleanupPlugin(this); }
}
