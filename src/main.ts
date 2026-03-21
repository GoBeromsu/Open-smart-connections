/**
 * @file main.ts
 * @description Main plugin entry point for Open Connections
 * Replaces SmartEnv orchestration with proper Obsidian Plugin architecture
 */

import {
  Plugin,
  TFile,
} from 'obsidian';

import type { PluginSettings } from './types/settings';
import { DEFAULT_SETTINGS } from './domain/config';
import { SmartConnectionsNotices, NOTICE_CATALOG } from './domain/notices';
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
  queueUnembeddedEntities as _queueUnembeddedEntities,
  getEmbeddingQueueSnapshot as _getEmbeddingQueueSnapshot,
  syncCollectionEmbeddingContext as _syncCollectionEmbeddingContext,
  getEmbedAdapterSettings as _getEmbedAdapterSettings,
} from './ui/embedding/collection-loader';
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
  runEmbeddingJobImmediate as _runEmbeddingJobImmediate,
  reembedStaleEntities as _reembedStaleEntities,
  getCurrentModelInfo as _getCurrentModelInfo,
  getActiveEmbeddingContext as _getActiveEmbeddingContext,
  logEmbed as _logEmbed,
  clearEmbedNotice as _clearEmbedNotice,
} from './ui/embedding/embed-orchestrator';
import { EmbeddingKernelStore } from './domain/embedding/kernel/store';
import { EmbeddingKernelJobQueue } from './domain/embedding/kernel/queue';
import {
  logKernelTransition,
} from './domain/embedding/kernel/effects';
import {
  isEmbedReady,
  toLegacyStatusState,
  type EmbedStatusState,
} from './domain/embedding/kernel/selectors';
import type {
  EmbeddingKernelEvent,
  EmbeddingKernelJob,
  EmbeddingKernelQueueSnapshot,
  EmbeddingKernelState,
} from './domain/embedding/kernel/types';
import { EmbedJobQueue } from './domain/embedding/queue/embed-job-queue';

// Core type imports needed for plugin fields
import type { EmbedModel } from './domain/models/embed';
import type { EmbedModelAdapter } from './types/models';
import type { SourceCollection, BlockCollection } from './domain/entities';
import type { EmbeddingPipeline, EmbedQueueStats } from './domain/search/embedding-pipeline';

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
  readonly logger = new PluginLogger('Open Connections');

  // Core components
  embed_model?: EmbedModel;
  _search_embed_model?: EmbedModelAdapter;
  source_collection?: SourceCollection;
  block_collection?: BlockCollection;
  embedding_pipeline?: EmbeddingPipeline;

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
    return isEmbedReady(this.getEmbeddingKernelState());
  }

  /**
   * Returns the adapter to use for search queries.
   * Priority: explicit _search_embed_model > indexing adapter's embed_query > indexing adapter.
   */
  get search_embed_model(): EmbedModelAdapter | undefined {
    if (this._search_embed_model) return this._search_embed_model;
    return this.embed_model?.adapter;
  }

  get status_state(): EmbedStatusState {
    return toLegacyStatusState(this.getEmbeddingKernelState());
  }

  async onload(): Promise<void> {
    this._unloading = false;
    console.log('Loading Open Connections plugin');

    await this.loadSettings();
    this.ensureEmbeddingKernel();

    if (this.app.workspace.layoutReady) {
      await this.initialize();
    } else {
      this.app.workspace.onLayoutReady(async () => {
        await this.initialize();
      });
    }

    this.registerView(
      CONNECTIONS_VIEW_TYPE,
      (leaf) => new ConnectionsView(leaf, this),
    );
    this.registerView(
      LOOKUP_VIEW_TYPE,
      (leaf) => new LookupView(leaf, this),
    );

    this.addSettingTab(new SmartConnectionsSettingsTab(this.app, this));
    registerCommands(this);

    this.addRibbonIcon('network', 'Open Connections', () => {
      ConnectionsView.open(this.app.workspace);
    });
    this.registerMarkdownCodeBlockProcessor('smart-connections', async (source, el) => {
      if (!this.source_collection) {
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

      const entity = this.source_collection.get(activeFile.path);
      if (!entity?.vec) {
        el.createEl('p', { text: 'No embedding available for this note.', cls: 'osc-state-text' });
        return;
      }

      try {
        const results = await this.source_collection.nearest_to(entity, { limit });
        const list = el.createEl('ul', { cls: 'osc-codeblock-results' });
        for (const r of results) {
          const score = Math.round((r.score ?? 0) * 100);
          const path = (r.item?.path ?? '').replace(/\.md$/, '');
          const li = list.createEl('li');
          const link = li.createEl('a', {
            text: path.split('/').pop() ?? path,
            cls: 'internal-link',
            attr: { 'data-href': path },
          });
          li.createSpan({ text: ` (${score}%)`, cls: 'osc-score--medium' });
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this.open_note(r.item?.path ?? '');
          });
        }
      } catch (_e) {
        el.createEl('p', { text: 'Failed to load connections.', cls: 'osc-state-text' });
      }
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
      // Update check removed — interrupting user focus is a bad pattern.
      // Users get updates via BRAT or manual check.
    }).catch(e => {
      console.error('Background embedding init failed:', e);
    });

    console.log(`[SC][Init] ✓ Core ready, embedding loading in background (${(performance.now() - t0).toFixed(0)}ms)`);
  }

  async initializeCore(): Promise<void> {
    const phase1Start = performance.now();
    console.log('[SC][Init] ▶ Phase 1: Core initialization starting');

    const TOTAL = 6;
    let step = 0;

    /**
     * Run an init step with timing and error capture.
     * Returns true on success, false on failure.
     * If `critical` is true, failure should abort the phase (caller checks return value).
     */
    const runStep = async (
      name: string,
      fn: () => void | Promise<void>,
      opts?: { critical?: boolean; onSuccess?: () => string | undefined },
    ): Promise<boolean> => {
      step++;
      const tag = `[${step}/${TOTAL}]`;
      console.log(`[SC][Init]   ${tag} ${name}...`);
      const t = performance.now();
      try {
        await fn();
        const extra = opts?.onSuccess?.();
        console.log(`[SC][Init]   ${tag} ${name} ✓ (${(performance.now() - t).toFixed(0)}ms)${extra ? ` — ${extra}` : ''}`);
        return true;
      } catch (e) {
        this.init_errors.push({ phase: name, error: e as Error });
        console.error(`[SC][Init]   ${tag} ${name} ✗ (${(performance.now() - t).toFixed(0)}ms):`, e);
        if (opts?.critical) {
          this.ready = false;
          this.dispatchKernelEvent({ type: 'INIT_CORE_FAILED', error: `Failed: ${name}` });
          console.log(`[SC][Init] ✗ Phase 1 aborted (${(performance.now() - phase1Start).toFixed(0)}ms): ${name} failed`);
        }
        return false;
      }
    };

    await runStep('Loading user state', () => this.loadUserState());
    await runStep('Waiting for sync', () => this.waitForSync());

    if (!await runStep('Initializing collections', () => this.initCollections(), { critical: true })) return;
    if (!await runStep('Loading collections', () => this.loadCollections(), {
      critical: true,
      onSuccess: () => {
        const sourceCount = this.source_collection ? Object.keys(this.source_collection.items).length : 0;
        const blockCount = this.block_collection ? Object.keys(this.block_collection.items).length : 0;
        return `${sourceCount} sources, ${blockCount} blocks`;
      },
    })) return;

    await runStep('Setting up status bar', () => this.setupStatusBar());
    await runStep('Registering file watchers', () => this.registerFileWatchers());

    this.ready = true;
    this.dispatchKernelEvent({ type: 'INIT_CORE_READY' });
    console.log(`[SC][Init] ✓ Phase 1 complete (${(performance.now() - phase1Start).toFixed(0)}ms) — ready=${this.ready}, errors=${this.init_errors.length}`);

    if (this.init_errors.length > 0) {
      console.warn('[SC][Init]   Phase 1 errors:', this.init_errors);
    }
  }

  async initializeEmbedding(): Promise<void> {
    const t0 = performance.now();
    let modelId = 'unknown';
    try {
      const es = this.settings.smart_sources.embed_model;
      const as_ = this.getEmbedAdapterSettings(es);
      modelId = `${es.adapter}/${as_.model_key || '?'}`;
    } catch { /* use default 'unknown' */ }
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
    // Migrate legacy Upstage model keys to canonical `embedding-passage`
    const upstageAdapter = settings.smart_sources?.embed_model as Record<string, any> | undefined;
    if (upstageAdapter?.adapter === 'upstage') {
      const upstageSettings = (settings as any)[`embed_model.upstage`] ?? upstageAdapter;
      const mk = upstageSettings?.model_key;
      if (mk && mk !== 'embedding-passage') {
        upstageSettings.model_key = 'embedding-passage';
        removedLegacyKeys = true;
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
    // Wait 3 seconds for other processes to finish
    await new Promise((r) => setTimeout(r, 3000));

    // Wait for Obsidian Sync if active
    while (this.obsidianIsSyncing()) {
      console.log('Open Connections: Waiting for Obsidian Sync to finish');
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
      logKernelTransition(_prev, event, state);
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
    const updateSnapshot = (): void => {
      this.dispatchKernelEvent({
        type: 'QUEUE_SNAPSHOT_UPDATED',
        queue: this.getEmbeddingQueueSnapshot(),
      });
    };
    updateSnapshot();
    void promise.then(updateSnapshot, updateSnapshot);
    return promise;
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

    // Unload search model adapter if separate from indexing
    if (this._search_embed_model?.unload) {
      this._search_embed_model.unload().catch((err: unknown) => {
        console.warn('Failed to unload search embed model:', err);
      });
      this._search_embed_model = undefined;
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

    // Persist and close SQLite databases
    import('./domain/entities').then(({ closeSqliteDatabases }) => {
      closeSqliteDatabases().catch((err: unknown) => {
        console.warn('Failed to close SQLite databases:', err);
      });
    });
  }
}
