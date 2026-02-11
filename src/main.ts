/**
 * @file main.ts
 * @description Main plugin entry point for Smart Connections
 * Replaces SmartEnv orchestration with proper Obsidian Plugin architecture
 */

import {
  Plugin,
  TFile,
} from 'obsidian';

import type { PluginSettings } from '../core/types/settings';
import { DEFAULT_SETTINGS } from './config';
import SmartConnectionsNotices from './notices';
import { SmartConnectionsSettingsTab } from './settings';
import { registerCommands } from './commands';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from './views/ConnectionsView';
import { ChatView, CHAT_VIEW_TYPE } from './views/ChatView';
import { LookupView, LOOKUP_VIEW_TYPE } from './views/LookupView';
import { setupStatusBar as _setupStatusBar, refreshStatus as _refreshStatus, handleStatusBarClick as _handleStatusBarClick } from './status-bar';
import {
  loadUserState as _loadUserState,
  handleNewUser as _handleNewUser,
  checkForUpdates as _checkForUpdates,
  addToGitignore as _addToGitignore,
  isNewUser as _isNewUser,
  saveInstalledAt as _saveInstalledAt,
  getDataJsonCreatedAt as _getDataJsonCreatedAt,
  migrateInstalledAtFromLocalStorage as _migrateInstalledAtFromLocalStorage,
  getLastKnownVersion as _getLastKnownVersion,
  setLastKnownVersion as _setLastKnownVersion,
  shouldShowReleaseNotes as _shouldShowReleaseNotes,
  checkForUpdate as _checkForUpdate,
} from './user-state';
import {
  initCollections as _initCollections,
  loadCollections as _loadCollections,
  queueUnembeddedEntities as _queueUnembeddedEntities,
  getEmbeddingQueueSnapshot as _getEmbeddingQueueSnapshot,
  syncCollectionEmbeddingContext as _syncCollectionEmbeddingContext,
  getEmbedAdapterSettings as _getEmbedAdapterSettings,
} from './embedding/collection-manager';
import {
  registerFileWatchers as _registerFileWatchers,
  isSourceFile as _isSourceFile,
  queueSourceReImport as _queueSourceReImport,
  removeSource as _removeSource,
  debounceReImport as _debounceReImport,
  runReImport as _runReImport,
} from './file-watcher';
import {
  initEmbedModel as _initEmbedModel,
  initPipeline as _initPipeline,
  switchEmbeddingModel as _switchEmbeddingModel,
  runEmbeddingJob as _runEmbeddingJob,
  runEmbeddingJobImmediate as _runEmbeddingJobImmediate,
  reembedStaleEntities as _reembedStaleEntities,
  getCurrentModelInfo as _getCurrentModelInfo,
  getActiveEmbeddingContext as _getActiveEmbeddingContext,
  logEmbed as _logEmbed,
  clearEmbedNotice as _clearEmbedNotice,
} from './embedding/embedding-manager';
import { EmbeddingKernelStore } from './embedding/kernel/store';
import { EmbeddingKernelJobQueue } from './embedding/kernel/queue';
import {
  logKernelTransition,
} from './embedding/kernel/effects';
import {
  isEmbedReady,
  toLegacyStatusState,
} from './embedding/kernel/selectors';
import type {
  EmbeddingKernelEvent,
  EmbeddingKernelJob,
  EmbeddingKernelQueueSnapshot,
  EmbeddingKernelState,
} from './embedding/kernel/types';
import { EmbedJobQueue } from './embedding/queue/embed-job-queue';

// Core type imports needed for plugin fields
import type { EmbedModel } from '../core/models/embed';
import type { SourceCollection, BlockCollection } from '../core/entities';
import type { EmbeddingPipeline, EmbedQueueStats } from '../core/search/embedding-pipeline';

export type EmbedStatusState =
  | 'idle'
  | 'embedding'
  | 'error';

export interface EmbeddingRunContext {
  runId: number;
  phase: 'running' | 'completed' | 'failed';
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  startedAt: number;
  current: number;
  total: number;
  sourceTotal: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
}

export interface EmbedProgressEventPayload {
  runId: number;
  phase: EmbeddingRunContext['phase'];
  reason: string;
  adapter: string;
  modelKey: string;
  dims: number | null;
  currentEntityKey: string | null;
  currentSourcePath: string | null;
  current: number;
  total: number;
  percent: number;
  sourceTotal: number;
  blockTotal: number;
  saveCount: number;
  sourceDataDir: string;
  blockDataDir: string;
  startedAt: number;
  elapsedMs: number;
  etaMs: number | null;
  done?: boolean;
  error?: string;
}

export default class SmartConnectionsPlugin extends Plugin {
  settings: PluginSettings;
  env: any; // Smart Environment instance
  status_elm?: HTMLElement;
  status_container?: HTMLElement;
  status_msg?: HTMLElement;
  re_import_timeout?: number;
  re_import_retry_timeout?: number;
  re_import_halted = false;
  _unloading = false;
  _installed_at: number | null = null;

  // Core components
  embed_model?: EmbedModel;
  source_collection?: SourceCollection;
  block_collection?: BlockCollection;
  embedding_pipeline?: EmbeddingPipeline;
  chat_model?: any; // For future chat integration

  // Initialization state flags
  ready: boolean = false;
  init_errors: Array<{ phase: string; error: Error }> = [];
  embed_run_seq: number = 0;
  active_embed_run_id: number | null = null;
  embed_notice_last_update = 0;
  embed_notice_last_percent = 0;
  current_embed_context: EmbeddingRunContext | null = null;
  embedding_kernel_store?: EmbeddingKernelStore;
  embedding_job_queue?: EmbeddingKernelJobQueue;
  embed_job_queue?: EmbedJobQueue;
  private embedding_kernel_unsubscribe?: () => void;
  private _notices?: SmartConnectionsNotices;

  get notices(): SmartConnectionsNotices {
    if (!this._notices) {
      this._notices = new SmartConnectionsNotices(this);
    }
    return this._notices;
  }

  get embed_ready(): boolean {
    return isEmbedReady(this.getEmbeddingKernelState());
  }

  get status_state(): EmbedStatusState {
    return toLegacyStatusState(this.getEmbeddingKernelState());
  }

  async onload(): Promise<void> {
    console.log('Loading Smart Connections plugin');

    // Load settings first
    await this.loadSettings();
    this.ensureEmbeddingKernel();

    // Wait for workspace to be ready before full initialization
    if (this.app.workspace.layoutReady) {
      // Layout already ready, initialize immediately
      await this.initialize();
    } else {
      // Layout not ready yet, wait for it
      this.app.workspace.onLayoutReady(async () => {
        await this.initialize();
      });
    }

    // Register views
    this.registerView(
      CONNECTIONS_VIEW_TYPE,
      (leaf) => new ConnectionsView(leaf, this),
    );

    // Conditionally register ChatView based on enable_chat setting
    if (this.settings.enable_chat) {
      this.registerView(
        CHAT_VIEW_TYPE,
        (leaf) => new ChatView(leaf, this),
      );
    }

    // Register Lookup view
    this.registerView(
      LOOKUP_VIEW_TYPE,
      (leaf) => new LookupView(leaf, this),
    );

    // Add settings tab
    this.addSettingTab(new SmartConnectionsSettingsTab(this.app, this));

    // Register commands
    registerCommands(this);

    // Add ribbon icon
    this.addRibbonIcon('network', 'Open Connections', () => {
      ConnectionsView.open(this.app.workspace);
    });
  }

  async initialize(): Promise<void> {
    const t0 = performance.now();
    console.log('[SC][Init] ▶ Initialization starting');

    // Phase 1: Core init (blocking)
    await this.initializeCore();

    // Phase 2: Embedding (background, fire-and-forget)
    this.initializeEmbedding().then(() => {
      // Handle new user after everything is loaded
      this.handleNewUser();
      this.checkForUpdates();
    }).catch(e => {
      console.error('Background embedding init failed:', e);
    });

    console.log(`[SC][Init] ✓ Core ready, embedding loading in background (${(performance.now() - t0).toFixed(0)}ms)`);
  }

  async initializeCore(): Promise<void> {
    const phase1Start = performance.now();
    console.log('[SC][Init] ▶ Phase 1: Core initialization starting');

    const logStep = (step: string, num: number, total: number = 6) =>
      console.log(`[SC][Init]   [${num}/${total}] ${step}...`);
    const logStepDone = (step: string, num: number, total: number = 6, elapsed: number, extra?: string) =>
      console.log(`[SC][Init]   [${num}/${total}] ${step} ✓ (${elapsed.toFixed(0)}ms)${extra ? ` — ${extra}` : ''}`);

    // Each step has own try-catch, pushes errors, continues

    // 1. Load user state
    {
      const t = performance.now();
      logStep('Loading user state', 1);
      try {
        await this.loadUserState();
        logStepDone('Loading user state', 1, 6, performance.now() - t);
      } catch (e) {
        this.init_errors.push({ phase: 'loadUserState', error: e as Error });
        console.error(`[SC][Init]   [1/6] Loading user state ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
      }
    }

    // 2. Wait for sync
    {
      const t = performance.now();
      logStep('Waiting for sync', 2);
      try {
        await this.waitForSync();
        logStepDone('Waiting for sync', 2, 6, performance.now() - t);
      } catch (e) {
        this.init_errors.push({ phase: 'waitForSync', error: e as Error });
        console.error(`[SC][Init]   [2/6] Waiting for sync ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
      }
    }

    // 3. Initialize collections (NO embed model needed!)
    {
      const t = performance.now();
      logStep('Initializing collections', 3);
      try {
        await this.initCollections();
        logStepDone('Initializing collections', 3, 6, performance.now() - t);
      } catch (e) {
        this.init_errors.push({ phase: 'initCollections', error: e as Error });
        console.error(`[SC][Init]   [3/6] Initializing collections ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
        // Collections are critical — abort initialization
        this.ready = false;
        this.dispatchKernelEvent({ type: 'INIT_CORE_FAILED', error: 'Failed to initialize collections' });
        console.log(`[SC][Init] ✗ Phase 1 aborted (${(performance.now() - phase1Start).toFixed(0)}ms): collections init failed`);
        return;
      }
    }

    // 4. Load collections from storage adapter
    {
      const t = performance.now();
      logStep('Loading collections', 4);
      try {
        await this.loadCollections();
        const sourceCount = this.source_collection ? Object.keys(this.source_collection.items).length : 0;
        const blockCount = this.block_collection ? Object.keys(this.block_collection.items).length : 0;
        logStepDone('Loading collections', 4, 6, performance.now() - t, `${sourceCount} sources, ${blockCount} blocks`);
      } catch (e) {
        this.init_errors.push({ phase: 'loadCollections', error: e as Error });
        console.error(`[SC][Init]   [4/6] Loading collections ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
        // Collection data is critical — abort initialization
        this.ready = false;
        this.dispatchKernelEvent({ type: 'INIT_CORE_FAILED', error: 'Failed to load collections' });
        console.log(`[SC][Init] ✗ Phase 1 aborted (${(performance.now() - phase1Start).toFixed(0)}ms): collections load failed`);
        return;
      }
    }

    // 5. Setup status bar
    {
      const t = performance.now();
      logStep('Setting up status bar', 5);
      try {
        this.setupStatusBar();
        logStepDone('Setting up status bar', 5, 6, performance.now() - t);
      } catch (e) {
        this.init_errors.push({ phase: 'setupStatusBar', error: e as Error });
        console.error(`[SC][Init]   [5/6] Setting up status bar ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
      }
    }

    // 6. Register file watchers
    {
      const t = performance.now();
      logStep('Registering file watchers', 6);
      try {
        this.registerFileWatchers();
        logStepDone('Registering file watchers', 6, 6, performance.now() - t);
      } catch (e) {
        this.init_errors.push({ phase: 'registerFileWatchers', error: e as Error });
        console.error(`[SC][Init]   [6/6] Registering file watchers ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
      }
    }

    this.ready = true;
    this.dispatchKernelEvent({ type: 'INIT_CORE_READY' });
    console.log(`[SC][Init] ✓ Phase 1 complete (${(performance.now() - phase1Start).toFixed(0)}ms) — ready=${this.ready}, errors=${this.init_errors.length}`);

    if (this.init_errors.length > 0) {
      console.warn('[SC][Init]   Phase 1 errors:', this.init_errors);
    }
  }

  async initializeEmbedding(): Promise<void> {
    const t0 = performance.now();
    const modelId = (() => {
      try {
        const es = this.settings.smart_sources.embed_model;
        const as_ = this.getEmbedAdapterSettings(es);
        return `${es.adapter}/${as_.model_key || '?'}`;
      } catch { return 'unknown'; }
    })();
    console.log(`[SC][Init] ▶ Phase 2: Embedding initialization starting (model: ${modelId})`);
    try {
      await this.switchEmbeddingModel('Initial embedding setup');
      console.log(`[SC][Init] ✓ Phase 2 complete (${(performance.now() - t0).toFixed(0)}ms)`);
    } catch (e) {
      this.init_errors.push({ phase: 'initializeEmbedding', error: e as Error });
      console.error(`[SC][Init] ✗ Phase 2 failed (${(performance.now() - t0).toFixed(0)}ms): ${e instanceof Error ? e.message : String(e)}`);
      this.dispatchKernelEvent({
        type: 'MODEL_SWITCH_FAILED',
        reason: 'Initial embedding setup',
        error: e instanceof Error ? e.message : String(e),
      });

      // Don't rethrow — Phase 1 is already working
    }
  }

  getActiveEmbeddingContext(): EmbeddingRunContext | null { return _getActiveEmbeddingContext(this); }
  getCurrentModelInfo(): { adapter: string; modelKey: string; dims: number | null } { return _getCurrentModelInfo(this); }
  logEmbed(event: string, context: Partial<EmbedProgressEventPayload> = {}): void { _logEmbed(this, event, context); }
  clearEmbedNotice(): void { _clearEmbedNotice(this); }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {}) as PluginSettings;
    if (!settings.smart_notices || typeof settings.smart_notices !== 'object') {
      settings.smart_notices = { muted: {} };
    }
    if (!settings.smart_notices.muted || typeof settings.smart_notices.muted !== 'object') {
      settings.smart_notices.muted = {};
    }
    this.settings = settings;
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
    // Wait 3 seconds for other processes to finish
    await new Promise((r) => setTimeout(r, 3000));

    // Wait for Obsidian Sync if active
    while (this.obsidianIsSyncing()) {
      console.log('Smart Connections: Waiting for Obsidian Sync to finish');
      await new Promise((r) => setTimeout(r, 1000));
    }
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
  getEmbeddingQueueSnapshot(): EmbeddingKernelQueueSnapshot { return _getEmbeddingQueueSnapshot(this); }
  async reembedStaleEntities(reason: string = 'Manual re-embed'): Promise<number> { return _reembedStaleEntities(this, reason); }
  async switchEmbeddingModel(reason: string = 'Embedding model switch'): Promise<void> { return _switchEmbeddingModel(this, reason); }

  async initCollections(): Promise<void> { return _initCollections(this); }
  async loadCollections(): Promise<void> { return _loadCollections(this); }

  async initPipeline(): Promise<void> { return _initPipeline(this); }
  async processInitialEmbedQueue(): Promise<void> { await _runEmbeddingJob(this, 'Initial queue'); }
  async runEmbeddingJob(reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> { return _runEmbeddingJob(this, reason); }
  async runEmbeddingJobImmediate(reason: string = 'Embedding run'): Promise<EmbedQueueStats | null> { return _runEmbeddingJobImmediate(this, reason); }

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
    if (this.embedding_kernel_store && this.embedding_job_queue) return;
    this.embedding_kernel_store = new EmbeddingKernelStore();
    this.embedding_job_queue = new EmbeddingKernelJobQueue();
    this.embed_job_queue = new EmbedJobQueue({
      onQueueHasItems: () => {
        this.dispatchKernelEvent({ type: 'QUEUE_HAS_ITEMS' });
      },
      onQueueEmpty: () => {
        this.dispatchKernelEvent({ type: 'QUEUE_EMPTY' });
      },
    });
    this.embedding_kernel_unsubscribe = this.embedding_kernel_store.subscribe((state, _prev, event) => {
      logKernelTransition(this, _prev, event, state);
      this.app.workspace.trigger('smart-connections:embed-state-changed' as any, {
        state,
        event,
      });
      this.refreshStatus();
    });
  }

  getEmbeddingKernelState(): EmbeddingKernelState {
    this.ensureEmbeddingKernel();
    return this.embedding_kernel_store!.getState();
  }

  dispatchKernelEvent(event: EmbeddingKernelEvent): EmbeddingKernelState {
    this.ensureEmbeddingKernel();
    return this.embedding_kernel_store!.dispatch(event);
  }

  enqueueEmbeddingJob<T = unknown>(job: EmbeddingKernelJob<T>): Promise<T> {
    this.ensureEmbeddingKernel();
    const promise = this.embedding_job_queue!.enqueue(job);
    this.dispatchKernelEvent({
      type: 'QUEUE_SNAPSHOT_UPDATED',
      queue: this.getEmbeddingQueueSnapshot(),
    });
    void promise.then(() => {
      this.dispatchKernelEvent({
        type: 'QUEUE_SNAPSHOT_UPDATED',
        queue: this.getEmbeddingQueueSnapshot(),
      });
    }, () => {
      this.dispatchKernelEvent({
        type: 'QUEUE_SNAPSHOT_UPDATED',
        queue: this.getEmbeddingQueueSnapshot(),
      });
    });
    return promise;
  }

  async handleNewUser(): Promise<void> { return _handleNewUser(this); }
  async checkForUpdates(): Promise<void> { return _checkForUpdates(this); }
  async checkForUpdate(): Promise<void> { return _checkForUpdate(this); }
  async getLastKnownVersion(): Promise<string> { return _getLastKnownVersion(this); }
  async setLastKnownVersion(version: string): Promise<void> { return _setLastKnownVersion(this, version); }
  async shouldShowReleaseNotes(currentVersion: string): Promise<boolean> { return _shouldShowReleaseNotes(this, currentVersion); }
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
    console.log('Unloading Smart Connections plugin');
    this._unloading = true;

    // Halt active embedding pipeline before clearing the queue
    this.embedding_pipeline?.halt();
    this.clearEmbedNotice();
    this._notices?.unload();
    this.embedding_kernel_unsubscribe?.();
    this.embedding_kernel_unsubscribe = undefined;
    this.embedding_job_queue?.clear('Plugin unload');
    this.embed_job_queue?.clear();

    // Clear timeouts
    if (this.re_import_timeout) {
      window.clearTimeout(this.re_import_timeout);
    }
    if (this.re_import_retry_timeout) {
      window.clearTimeout(this.re_import_retry_timeout);
    }

    // Fire-and-forget async cleanup with error handling
    // Obsidian does not await onunload, so we cannot use await here
    if (this.embed_model) {
      this.embed_model.unload().catch((err: unknown) => {
        console.warn('Failed to unload embed model:', err);
      });
    }

    // Unload environment
    this.env?.unload?.();
  }
}
