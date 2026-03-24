/**
 * @file main.ts
 * @description Main plugin entry point for Open Connections
 * Replaces SmartEnv orchestration with proper Obsidian Plugin architecture
 */

import {
  Plugin,
  TFile,
} from 'obsidian';
import { average_vectors } from './utils';

import type { PluginSettings } from './types/settings';
import { DEFAULT_SETTINGS, NOTICE_CATALOG } from './domain/config';
import { PluginNotices as SmartConnectionsNotices } from './shared/plugin-notices';
import { PluginLogger } from './shared/plugin-logger';
import { SmartConnectionsSettingsTab } from './ui/settings';
import { registerCommands } from './ui/commands';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from './ui/ConnectionsView';
import { LookupView, LOOKUP_VIEW_TYPE } from './ui/LookupView';
import { setupStatusBar as _setupStatusBar, refreshStatus as _refreshStatus, handleStatusBarClick as _handleStatusBarClick } from './ui/status-bar';
import {
  loadUserState as _loadUserState,
  handleNewUser as _handleNewUser,
  addToGitignore as _addToGitignore,
  isNewUser as _isNewUser,
  saveInstalledAt as _saveInstalledAt,
  getDataJsonCreatedAt as _getDataJsonCreatedAt,
  migrateInstalledAtFromLocalStorage as _migrateInstalledAtFromLocalStorage,
  getLastKnownVersion as _getLastKnownVersion,
  setLastKnownVersion as _setLastKnownVersion,
} from './ui/user-state';
import {
  initCollections as _initCollections,
  loadCollections as _loadCollections,
  detectStaleSourcesOnStartup as _detectStaleSourcesOnStartup,
  processNewSourcesChunked as _processNewSourcesChunked,
  queueUnembeddedEntities as _queueUnembeddedEntities,
  syncCollectionEmbeddingContext as _syncCollectionEmbeddingContext,
  getEmbedAdapterSettings as _getEmbedAdapterSettings,
} from './ui/collection-loader';
import {
  registerFileWatchers as _registerFileWatchers,
  isSourceFile as _isSourceFile,
  queueSourceReImport as _queueSourceReImport,
  removeSource as _removeSource,
  debounceReImport as _debounceReImport,
  runReImport as _runReImport,
} from './ui/file-watcher';
import {
  initEmbedModel as _initEmbedModel,
  initPipeline as _initPipeline,
  switchEmbeddingModel as _switchEmbeddingModel,
  runEmbeddingJob as _runEmbeddingJob,
  reembedStaleEntities as _reembedStaleEntities,
  getCurrentModelInfo as _getCurrentModelInfo,
  getActiveEmbeddingContext as _getActiveEmbeddingContext,
  logEmbed as _logEmbed,
  clearEmbedNotice as _clearEmbedNotice,
} from './ui/embed-orchestrator';
import {
  EmbeddingKernelJobQueue,
} from './domain/embedding/kernel';
import { closeNodeSqliteDatabases } from './domain/entities';
import type {
  EmbeddingKernelJob,
} from './domain/embedding/kernel/types';

// Core type imports needed for plugin fields
import type { EmbedModelAdapter } from './types/models';
import type { SourceCollection, BlockCollection } from './domain/entities';
import type {
  EmbeddingPipeline,
  EmbedQueueStats,
  EmbedRunOutcome,
} from './domain/embedding-pipeline';

export interface EmbeddingRunContext {
  runId: number;
  phase: 'running' | 'completed' | 'halted' | 'failed' | 'followup-required';
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  startedAt: number;
  current: number;
  total: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  followupQueued?: boolean;
  error?: string | null;
}

export interface EmbedProgressEventPayload {
  runId: number;
  phase: EmbeddingRunContext['phase'];
  outcome?: EmbedRunOutcome;
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  current: number;
  total: number;
  percent: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  startedAt: number;
  elapsedMs: number;
  followupQueued?: boolean;
  done?: boolean;
  error?: string;
}

export default class SmartConnectionsPlugin extends Plugin {
  settings: PluginSettings;
  status_elm?: HTMLElement;
  status_container?: HTMLElement;
  status_msg?: HTMLElement;
  re_import_timeout?: number;
  _unloading = false;
  _installed_at: number | null = null;
  readonly logger = new PluginLogger('Open Connections');

  // Core components
  embed_adapter?: EmbedModelAdapter;
  _search_embed_model?: EmbedModelAdapter;
  source_collection?: SourceCollection;
  block_collection?: BlockCollection;
  embedding_pipeline?: EmbeddingPipeline;

  // Initialization state flags
  ready: boolean = false;
  init_errors: Array<{ phase: string; error: Error }> = [];
  embed_run_seq: number = 0;
  embed_notice_last_update = 0;
  embed_notice_last_percent = 0;
  current_embed_context: EmbeddingRunContext | null = null;
  embedding_job_queue?: EmbeddingKernelJobQueue;
  pendingReImportPaths = new Set<string>();
  private _lifecycle_epoch = 0;
  private _embed_state: { phase: 'idle' | 'running' | 'error'; modelFingerprint: string | null; lastError: string | null } = {
    phase: 'idle',
    modelFingerprint: null,
    lastError: null,
  };
  private _notices?: SmartConnectionsNotices;

  get notices(): SmartConnectionsNotices {
    if (!this._notices) {
      // PluginNoticesHost expects settings as Record<string, unknown>.
      // Cast is safe: PluginSettings is a plain object. _notices is invalidated
      // in loadSettings() whenever this.settings is reassigned.
      const host = {
        settings: this.settings as unknown as Record<string, unknown>,
        saveSettings: () => this.saveSettings(),
      };
      this._notices = new SmartConnectionsNotices(host, NOTICE_CATALOG, 'Open Connections');
    }
    return this._notices;
  }

  get embed_ready(): boolean {
    return this._embed_state.phase !== 'error' && this._embed_state.modelFingerprint !== null;
  }

  /**
   * Returns the adapter to use for search queries.
   * Priority: explicit _search_embed_model > indexing adapter's embed_query > indexing adapter.
   */
  get search_embed_model(): EmbedModelAdapter | undefined {
    if (this._search_embed_model) return this._search_embed_model;
    return this.embed_adapter;
  }

  get status_state(): 'idle' | 'embedding' | 'error' {
    return this._embed_state.phase === 'running' ? 'embedding' : this._embed_state.phase;
  }

  private beginLifecycle(): number {
    this._lifecycle_epoch += 1;
    return this._lifecycle_epoch;
  }

  private isCurrentLifecycle(epoch: number): boolean {
    return !this._unloading && this._lifecycle_epoch === epoch;
  }

  private resetTransientRuntimeState(): void {
    this.ready = false;
    this.current_embed_context = null;
    this.embed_notice_last_update = 0;
    this.embed_notice_last_percent = 0;
    this.init_errors = [];
    this.pendingReImportPaths.clear();
    this._embed_state = {
      phase: 'idle',
      modelFingerprint: null,
      lastError: null,
    };
    this.embedding_job_queue?.clear('Plugin reset');
    this.embedding_job_queue = undefined;
    this.embedding_pipeline?.halt();
    this.embedding_pipeline = undefined;
    this.embed_adapter = undefined;
    this._search_embed_model = undefined;
    this.source_collection = undefined;
    this.block_collection = undefined;
    this._notices = undefined;
  }

  setEmbedPhase(phase: 'idle' | 'running' | 'error', opts: { error?: string; fingerprint?: string } = {}): void {
    const prev = this._embed_state.phase;
    this._embed_state = {
      phase,
      modelFingerprint: opts.fingerprint ?? this._embed_state.modelFingerprint,
      lastError: phase === 'error' ? (opts.error ?? this._embed_state.lastError) : null,
    };
    if (prev !== phase) {
      console.log(`[Open Connections] ${prev} → ${phase}${opts.error ? `: ${opts.error}` : ''}`);
      this.app.workspace.trigger('open-connections:embed-state-changed' as any, { phase, prev });
      this.refreshStatus();
    }
  }

  resetError(): void {
    if (this._embed_state.lastError) {
      this._embed_state = { ...this._embed_state, lastError: null };
    }
  }

  async onload(): Promise<void> {
    this._unloading = false;
    const lifecycle = this.beginLifecycle();
    this.resetTransientRuntimeState();
    console.log('Loading Open Connections plugin');

    await this.loadSettings();
    if (!this.isCurrentLifecycle(lifecycle)) return;

    if (this.app.workspace.layoutReady) {
      await this.initialize(lifecycle);
    } else {
      this.app.workspace.onLayoutReady(async () => {
        if (!this.isCurrentLifecycle(lifecycle)) return;
        await this.initialize(lifecycle);
      });
    }

    if (!this.isCurrentLifecycle(lifecycle)) return;

    this.registerView(
      CONNECTIONS_VIEW_TYPE,
      (leaf) => new ConnectionsView(leaf, this),
    );
    this.registerView(
      LOOKUP_VIEW_TYPE,
      (leaf) => new LookupView(leaf, this),
    );
    // Migration: redirect old view types to new ones
    this.registerView('smart-connections-view', (leaf) => new ConnectionsView(leaf, this));
    this.registerView('smart-connections-lookup', (leaf) => new LookupView(leaf, this));

    this.addSettingTab(new SmartConnectionsSettingsTab(this.app, this));
    registerCommands(this);

    this.addRibbonIcon('network', 'Open Connections', () => {
      ConnectionsView.open(this.app.workspace);
    });
    this.registerMarkdownCodeBlockProcessor('smart-connections', async (source, el) => {
      if (!this.block_collection) {
        el.createEl('p', { text: 'Open Connections is loading...', cls: 'osc-state-text' });
        return;
      }

      const lines = source.trim().split('\n');
      const config: Record<string, string> = {};
      for (const line of lines) {
        const [key, ...rest] = line.split(':');
        if (key) config[key.trim()] = rest.join(':').trim();
      }

      const limit = parseInt(config.limit || '5', 10);
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) return;

      // Find embedded blocks for this file and load their vectors on demand
      const fileBlocks = this.block_collection.all.filter(
        (b: any) => b.source_key === activeFile.path && b.has_embed(),
      );
      if (fileBlocks.length === 0) {
        el.createEl('p', { text: 'No embedding available for this note.', cls: 'osc-state-text' });
        return;
      }

      await Promise.all(fileBlocks.map((b: any) => this.block_collection.ensure_entity_vector(b)));
      const loadedBlocks = fileBlocks.filter((b: any) => b.vec && b.vec.length > 0);
      if (loadedBlocks.length === 0) {
        el.createEl('p', { text: 'No embedding available for this note.', cls: 'osc-state-text' });
        return;
      }

      const avgVec = average_vectors(loadedBlocks.map((b: any) => b.vec));
      loadedBlocks.forEach((b: any) => (b as any).evictVec?.());

      try {
        const blockKeys = fileBlocks.map((b: any) => b.key);
        const results = await this.block_collection.nearest(avgVec, { limit: limit * 3, exclude: blockKeys });
        // Dedupe by source path, keep highest score
        const seen = new Map<string, { score: number; path: string; heading: string }>();
        for (const r of results) {
          const key = r.item?.key ?? '';
          const sourcePath = key.split('#')[0];
          const heading = key.includes('#') ? key.split('#').pop() ?? '' : '';
          const score = r.score ?? 0;
          if (!seen.has(sourcePath) || score > (seen.get(sourcePath)?.score ?? 0)) {
            seen.set(sourcePath, { score, path: sourcePath, heading });
          }
        }
        const deduped = [...seen.values()].slice(0, limit);
        const list = el.createEl('ul', { cls: 'osc-codeblock-results' });
        for (const r of deduped) {
          const score = Math.round(r.score * 100);
          const displayPath = r.path.replace(/\.md$/, '');
          const li = list.createEl('li');
          const link = li.createEl('a', {
            text: displayPath.split('/').pop() ?? displayPath,
            cls: 'internal-link',
            attr: { 'data-href': displayPath },
          });
          li.createSpan({ text: ` (${score}%)`, cls: 'osc-score--medium' });
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this.open_note(r.path);
          });
        }
      } catch (e) {
        console.error("[SC] Codeblock: failed to load connections:", e);
        el.createEl('p', { text: 'Failed to load connections.', cls: 'osc-state-text' });
      }
    });
  }

  async initialize(lifecycle: number = this._lifecycle_epoch): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycle)) return;
    console.log('[SC][Init] ▶ Initialization starting');

    // Phase 1: Core init (blocking)
    await this.initializeCore(lifecycle);
    if (!this.isCurrentLifecycle(lifecycle)) return;

    // Phase 2: Embedding (background, fire-and-forget)
    this.initializeEmbedding(lifecycle).then(() => {
      if (!this.isCurrentLifecycle(lifecycle)) return;
      this.handleNewUser();
    }).catch(e => {
      console.error('Background embedding init failed:', e);
    });
  }

  async initializeCore(lifecycle: number = this._lifecycle_epoch): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycle)) return;
    const t0 = performance.now();
    console.log('[SC][Init] ▶ Phase 1: Core initialization');

    this.setupStatusBar();

    const runStep = async (
      name: string,
      fn: () => void | Promise<void>,
      critical = false,
    ): Promise<boolean> => {
      try {
        await fn();
        if (!this.isCurrentLifecycle(lifecycle)) {
          return false;
        }
        return true;
      } catch (e) {
        if (!this.isCurrentLifecycle(lifecycle)) {
          return false;
        }
        this.init_errors.push({ phase: name, error: e as Error });
        console.error(`[SC][Init] ${name} failed:`, e);
        if (critical) {
          this.ready = false;
          this.setEmbedPhase('error', { error: `Failed: ${name}` });
        }
        return false;
      }
    };

    await runStep('Load user state', () => this.loadUserState());
    if (!this.isCurrentLifecycle(lifecycle)) return;
    await runStep('Wait for sync', () => this.waitForSync());
    if (!this.isCurrentLifecycle(lifecycle)) return;
    if (!await runStep('Init collections', () => this.initCollections(), true)) return;
    if (!this.isCurrentLifecycle(lifecycle)) return;
    if (!await runStep('Load collections', () => this.loadCollections(), true)) return;
    if (!this.isCurrentLifecycle(lifecycle)) return;
    await this.detectStaleSourcesOnStartup();
    if (!this.isCurrentLifecycle(lifecycle)) return;
    await runStep('Register file watchers', () => this.registerFileWatchers());
    if (!this.isCurrentLifecycle(lifecycle)) return;

    this.ready = true;
    this.refreshStatus();
    this.app.workspace.trigger('open-connections:core-ready' as any);

    const sourceCount = this.source_collection?.size ?? 0;
    const blockCount = this.block_collection?.size ?? 0;
    console.log(`[SC][Init] ✓ Phase 1 complete (${(performance.now() - t0).toFixed(0)}ms) — ${sourceCount} sources, ${blockCount} blocks`);
  }

  async initializeEmbedding(lifecycle: number = this._lifecycle_epoch): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycle)) return;
    const t0 = performance.now();
    console.log('[SC][Init] ▶ Phase 2: Embedding initialization');
    try {
      if (!this.isCurrentLifecycle(lifecycle)) return;
      await this.switchEmbeddingModel('Initial embedding setup');
      if (!this.isCurrentLifecycle(lifecycle)) return;
      await _processNewSourcesChunked(this);
      if (!this.isCurrentLifecycle(lifecycle)) return;

      // Trigger re-import for stale sources detected during startup (#36)
      if (!this._unloading && this.pendingReImportPaths.size > 0) {
        console.log(`[SC][Init] Processing ${this.pendingReImportPaths.size} stale sources from startup detection`);
        this.debounceReImport();
      }
      if (!this.isCurrentLifecycle(lifecycle)) return;

      // Resume stranded unembedded blocks from interrupted runs (#50)
      if (this.embedding_pipeline && !this._unloading) {
        const resumeCount = this.queueUnembeddedEntities();
        if (resumeCount > 0) {
          console.log(`[SC][Init] Resuming ${resumeCount} stranded unembedded blocks`);
          await this.runEmbeddingJob('[startup] resume stranded blocks');
        }
      }
      if (!this.isCurrentLifecycle(lifecycle)) return;

      console.log(`[SC][Init] ✓ Phase 2 complete (${(performance.now() - t0).toFixed(0)}ms)`);
    } catch (e) {
      if (!this.isCurrentLifecycle(lifecycle)) return;
      this.init_errors.push({ phase: 'initializeEmbedding', error: e as Error });
      console.error('[SC][Init] ✗ Phase 2 failed:', e);
      this.setEmbedPhase('error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  getActiveEmbeddingContext(): EmbeddingRunContext | null { return _getActiveEmbeddingContext(this); }
  getCurrentModelInfo(): { adapter: string; modelKey: string; dims: number | null } { return _getCurrentModelInfo(this); }
  logEmbed(event: string, context: Partial<EmbedProgressEventPayload> = {}): void { _logEmbed(this, event, context); }
  clearEmbedNotice(): void { _clearEmbedNotice(this); }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const loadedSettings = (data?.settings && typeof data.settings === 'object')
      ? { ...data.settings as Record<string, unknown> }
      : {};
    let removedLegacyKeys = false;

    if (Object.prototype.hasOwnProperty.call(loadedSettings, 'enable_chat')) {
      delete loadedSettings.enable_chat;
      removedLegacyKeys = true;
    }
    if (Object.prototype.hasOwnProperty.call(loadedSettings, 'smart_chat_threads')) {
      delete loadedSettings.smart_chat_threads;
      removedLegacyKeys = true;
    }

    const settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings) as PluginSettings;

    // Deep-merge nested objects that shallow Object.assign misses.
    // Without this, a saved smart_sources without the adapter sub-key
    // causes embed_model_key to resolve to 'None' → full re-embed on update.
    if (loadedSettings.smart_sources && typeof loadedSettings.smart_sources === 'object') {
      const loaded = loadedSettings.smart_sources as Record<string, any>;
      settings.smart_sources = { ...DEFAULT_SETTINGS.smart_sources, ...loaded };
      if (loaded.embed_model && typeof loaded.embed_model === 'object') {
        settings.smart_sources.embed_model = {
          ...DEFAULT_SETTINGS.smart_sources.embed_model,
          ...loaded.embed_model,
        };
        const adapter = settings.smart_sources.embed_model.adapter;
        const defaults = (DEFAULT_SETTINGS.smart_sources.embed_model as Record<string, any>)[adapter];
        const saved = (loaded.embed_model as Record<string, any>)[adapter];
        if (defaults && typeof defaults === 'object') {
          (settings.smart_sources.embed_model as Record<string, any>)[adapter] = {
            ...defaults,
            ...(saved && typeof saved === 'object' ? saved : {}),
          };
        }
      }
    }
    if (loadedSettings.smart_blocks && typeof loadedSettings.smart_blocks === 'object') {
      settings.smart_blocks = { ...DEFAULT_SETTINGS.smart_blocks, ...(loadedSettings.smart_blocks as Record<string, any>) };
    }
    if (loadedSettings.smart_view_filter && typeof loadedSettings.smart_view_filter === 'object') {
      settings.smart_view_filter = { ...DEFAULT_SETTINGS.smart_view_filter, ...(loadedSettings.smart_view_filter as Record<string, any>) };
    }
    // Migrate legacy smart_notices.muted → plugin_notices.muted
    const legacyMuted = (settings.smart_notices as Record<string, unknown> | undefined)?.muted;
    if (legacyMuted && typeof legacyMuted === 'object' && Object.keys(legacyMuted).length > 0) {
      const settingsAsRecord = settings as unknown as Record<string, unknown>;
      if (!settingsAsRecord['plugin_notices'] || typeof settingsAsRecord['plugin_notices'] !== 'object') {
        settingsAsRecord['plugin_notices'] = { muted: {} };
      }
      const pn = settingsAsRecord['plugin_notices'] as Record<string, unknown>;
      if (!pn['muted'] || typeof pn['muted'] !== 'object') {
        pn['muted'] = {};
      }
      const destMuted = pn['muted'] as Record<string, boolean>;
      for (const [k, v] of Object.entries(legacyMuted as Record<string, unknown>)) {
        if (v === true) destMuted[k] = true;
      }
      settings.smart_notices = { muted: {} };
      removedLegacyKeys = true;
    }
    // Migrate legacy Upstage model keys to canonical `embedding-passage` (#42)
    const upstageAdapter = settings.smart_sources?.embed_model as Record<string, any> | undefined;
    if (upstageAdapter?.adapter === 'upstage') {
      let upstageSettings = (upstageAdapter as any)?.['upstage'];
      if (!upstageSettings) {
        upstageSettings = { model_key: 'embedding-passage' };
        (upstageAdapter as any)['upstage'] = upstageSettings;
        removedLegacyKeys = true;
      } else {
        const mk = upstageSettings.model_key;
        if (mk && mk !== 'embedding-passage') {
          upstageSettings.model_key = 'embedding-passage';
          removedLegacyKeys = true;
        }
      }
    }

    this.settings = settings;
    // Invalidate cached notices host so it picks up the new settings object.
    this._notices = undefined;
    if (removedLegacyKeys) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    const data = await this.loadData() || {};
    data.settings = this.settings;
    await this.saveData(data);
  }

  async loadUserState(): Promise<void> { return _loadUserState(this); }
  async getDataJsonCreatedAt(): Promise<number | null> { return _getDataJsonCreatedAt(this); }
  migrateInstalledAtFromLocalStorage(): boolean { return _migrateInstalledAtFromLocalStorage(this); }
  async saveInstalledAt(value: number): Promise<void> { return _saveInstalledAt(this, value); }
  isNewUser(): boolean { return _isNewUser(this); }

  async waitForSync(): Promise<void> {
    if (!this.obsidianIsSyncing()) return;
    console.log('[SC][Init] Waiting for Obsidian Sync to finish...');
    const deadline = Date.now() + 60_000; // 60s timeout
    await new Promise(r => setTimeout(r, 1000));
    while (this.obsidianIsSyncing()) {
      if (this._unloading) {
        console.warn('[SC][Init] Plugin unloading during sync wait, aborting');
        return;
      }
      if (Date.now() > deadline) {
        console.warn('[SC][Init] Sync wait timed out after 60s, proceeding without sync completion');
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('[SC][Init] Obsidian Sync complete');
  }

  obsidianIsSyncing(): boolean {
    const syncInstance = (this.app as any)?.internalPlugins?.plugins?.sync?.instance;
    if (!syncInstance) return false;
    if (syncInstance?.syncStatus?.startsWith('Uploading')) return false;
    if (syncInstance?.syncStatus?.startsWith('Fully synced')) return false;
    return syncInstance?.syncing ?? false;
  }

  async initEmbedModel(): Promise<void> { return _initEmbedModel(this); }
  syncCollectionEmbeddingContext(): void { _syncCollectionEmbeddingContext(this); }
  getEmbedAdapterSettings(embedSettings?: Record<string, any>): Record<string, any> { return _getEmbedAdapterSettings(embedSettings); }
  queueUnembeddedEntities(): number { return _queueUnembeddedEntities(this); }
  async reembedStaleEntities(reason: string = 'Manual re-embed'): Promise<number> { return _reembedStaleEntities(this, reason); }
  async switchEmbeddingModel(reason: string = 'Embedding model switch'): Promise<void> { return _switchEmbeddingModel(this, reason); }

  async initCollections(): Promise<void> { return _initCollections(this); }
  async loadCollections(): Promise<void> { return _loadCollections(this); }
  async detectStaleSourcesOnStartup(): Promise<number> { return _detectStaleSourcesOnStartup(this); }

  async initPipeline(): Promise<void> { return _initPipeline(this); }
  async runEmbeddingJob(reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> { return _runEmbeddingJob(this, reason); }

  registerFileWatchers(): void { _registerFileWatchers(this); }
  isSourceFile(file: TFile): boolean { return _isSourceFile(file); }
  queueSourceReImport(path: string): void { _queueSourceReImport(this, path); }
  removeSource(path: string): void { _removeSource(this, path); }
  debounceReImport(): void { _debounceReImport(this); }
  async runReImport(): Promise<void> { return _runReImport(this); }

  setupStatusBar(): void { _setupStatusBar(this); }
  refreshStatus(): void { _refreshStatus(this); }
  handleStatusBarClick(): void { _handleStatusBarClick(this); }

  ensureEmbeddingKernel(): void {
    if (this.embedding_job_queue) return;
    this.embedding_job_queue = new EmbeddingKernelJobQueue();
  }

  enqueueEmbeddingJob<T = unknown>(job: EmbeddingKernelJob<T>): Promise<T> {
    this.ensureEmbeddingKernel();
    return this.embedding_job_queue!.enqueue(job);
  }

  async handleNewUser(): Promise<void> { return _handleNewUser(this); }
  async getLastKnownVersion(): Promise<string> { return _getLastKnownVersion(this); }
  async setLastKnownVersion(version: string): Promise<void> { return _setLastKnownVersion(this, version); }
  async addToGitignore(ignore: string, message: string | null = null): Promise<void> { return _addToGitignore(this, ignore, message); }

  async open_note(targetPath: string, event: MouseEvent | null = null): Promise<void> {
    // Open note using Obsidian's navigation
    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (file instanceof TFile) {
      const mode = event?.ctrlKey || event?.metaKey ? 'tab' : 'source';
      await this.app.workspace.getLeaf(mode === 'tab').openFile(file);
    }
  }

  onunload(): void {
    console.log('Unloading Open Connections plugin');
    this.beginLifecycle();
    this._unloading = true;

    // Halt active embedding pipeline before clearing the queue
    this.embedding_pipeline?.halt();
    this.clearEmbedNotice();
    this._notices?.unload();

    // Clear timeouts
    if (this.re_import_timeout) {
      window.clearTimeout(this.re_import_timeout);
      this.re_import_timeout = undefined;
    }

    // Fire-and-forget async cleanup with error handling
    // Obsidian does not await onunload, so we cannot use await here
    if (this._search_embed_model?.unload) {
      this._search_embed_model.unload().catch((err: unknown) => {
        console.warn('Failed to unload search embed model:', err);
      });
    }

    if (this.embed_adapter?.unload) {
      this.embed_adapter.unload().catch((err: unknown) => {
        console.warn('Failed to unload embed model:', err);
      });
    }

    // Flush pending save queues before closing DBs — ensures deleted files
    // and in-memory state changes are persisted. All three calls go through
    // the same queueDbOperation queue, so saves complete before close.
    const srcAdapter = this.source_collection?.data_adapter;
    const blkAdapter = this.block_collection?.data_adapter;

    // resetTransientRuntimeState MUST run synchronously so tests and hot-reload
    // see ready=false immediately after onunload().
    this.resetTransientRuntimeState();

    // Fire-and-forget: saves enqueue into the same DB operation queue as close,
    // so ordering (save → save → close) is preserved by the queue.
    if (srcAdapter) srcAdapter.save().catch((e: unknown) => console.warn('[SC] Flush source save failed:', e));
    if (blkAdapter) blkAdapter.save().catch((e: unknown) => console.warn('[SC] Flush block save failed:', e));
    closeNodeSqliteDatabases();
  }
}
