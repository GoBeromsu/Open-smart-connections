/**
 * @file main.ts
 * @description Main plugin entry point for Smart Connections
 * Replaces SmartEnv orchestration with proper Obsidian Plugin architecture
 */

import {
  Notice,
  Plugin,
  TFile,
  setIcon,
  Platform,
  requestUrl,
} from 'obsidian';

import type { PluginSettings } from '../core/types/settings';
import { DEFAULT_SETTINGS } from './config';
import { SmartConnectionsSettingsTab } from './settings';
import { registerCommands } from './commands';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from './views/ConnectionsView';
import { ChatView, CHAT_VIEW_TYPE } from './views/ChatView';
import { LookupView, LOOKUP_VIEW_TYPE } from './views/LookupView';
import { determine_installed_at } from './utils/determine_installed_at';

// Import embedding models and adapters
import { EmbedModel } from '../core/models/embed';
import { TransformersEmbedAdapter, TRANSFORMERS_EMBED_MODELS } from '../core/models/embed/adapters/transformers';
import { OpenAIEmbedAdapter, OPENAI_EMBED_MODELS } from '../core/models/embed/adapters/openai';
import { OllamaEmbedAdapter } from '../core/models/embed/adapters/ollama';
import { GeminiEmbedAdapter, GEMINI_EMBED_MODELS } from '../core/models/embed/adapters/gemini';
import { LmStudioEmbedAdapter } from '../core/models/embed/adapters/lm_studio';
import { UpstageEmbedAdapter, UPSTAGE_EMBED_MODELS } from '../core/models/embed/adapters/upstage';
import { OpenRouterEmbedAdapter } from '../core/models/embed/adapters/open_router';

// Import entity collections
import { SourceCollection, BlockCollection, AjsonDataAdapter } from '../core/entities';

// Import embedding pipeline
import { EmbeddingPipeline } from '../core/search/embedding-pipeline';

export default class SmartConnectionsPlugin extends Plugin {
  settings: PluginSettings;
  env: any; // Smart Environment instance
  status_elm?: HTMLElement;
  status_container?: HTMLElement;
  status_msg?: HTMLElement;
  re_import_queue: Record<string, any> = {};
  re_import_timeout?: number;
  re_import_retry_timeout?: number;
  re_import_halted = false;
  _installed_at: number | null = null;

  // Core components
  embed_model?: EmbedModel;
  source_collection?: SourceCollection;
  block_collection?: BlockCollection;
  embedding_pipeline?: EmbeddingPipeline;
  chat_model?: any; // For future chat integration

  // Initialization state flags
  ready: boolean = false;
  embed_ready: boolean = false;
  status_state: 'idle' | 'loading_model' | 'embedding' | 'paused' | 'error' = 'idle';
  init_errors: Array<{ phase: string; error: Error }> = [];

  async onload(): Promise<void> {
    console.log('Loading Smart Connections plugin');

    // Load settings first
    await this.loadSettings();

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
    console.log('Initializing Smart Connections...');

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

    console.log('Smart Connections initialized (core ready, embedding loading in background)');
  }

  async initializeCore(): Promise<void> {
    // Each step has own try-catch, pushes errors, continues

    // 1. Load user state
    try {
      await this.loadUserState();
    } catch (e) {
      this.init_errors.push({ phase: 'loadUserState', error: e as Error });
      console.error('Failed to load user state:', e);
    }

    // 2. Wait for sync
    try {
      await this.waitForSync();
    } catch (e) {
      this.init_errors.push({ phase: 'waitForSync', error: e as Error });
      console.error('Failed waiting for sync:', e);
    }

    // 3. Initialize collections (NO embed model needed!)
    try {
      await this.initCollections();
    } catch (e) {
      this.init_errors.push({ phase: 'initCollections', error: e as Error });
      console.error('Failed to init collections:', e);
    }

    // 4. Load collections from AJSON
    try {
      await this.loadCollections();
    } catch (e) {
      this.init_errors.push({ phase: 'loadCollections', error: e as Error });
      console.error('Failed to load collections:', e);
    }

    // 5. Setup status bar
    try {
      this.setupStatusBar();
    } catch (e) {
      this.init_errors.push({ phase: 'setupStatusBar', error: e as Error });
      console.error('Failed to setup status bar:', e);
    }

    // 6. Register file watchers
    try {
      this.registerFileWatchers();
    } catch (e) {
      this.init_errors.push({ phase: 'registerFileWatchers', error: e as Error });
      console.error('Failed to register file watchers:', e);
    }

    this.ready = true;
    console.log('Smart Connections core initialized (Phase 1 complete)');

    if (this.init_errors.length > 0) {
      console.warn(`Phase 1 completed with ${this.init_errors.length} errors:`, this.init_errors);
    }
  }

  async initializeEmbedding(): Promise<void> {
    try {
      // 1. Initialize embed model
      this.status_state = 'loading_model';
      this.refreshStatus();

      await this.initEmbedModel();
      this.syncCollectionEmbeddingContext();
      const queued_after_sync = this.queueUnembeddedEntities();
      console.log(
        `Queued ${queued_after_sync} entities for embedding after model context sync`,
      );

      // 2. Initialize embedding pipeline
      await this.initPipeline();

      // Mark as ready — model is loaded, connections view can use cached vectors
      this.embed_ready = true;
      this.status_state = 'idle';
      this.refreshStatus();

      console.log('Smart Connections embedding ready (Phase 2 complete)');

      // Emit workspace event so views can react
      this.app.workspace.trigger('smart-connections:embed-ready');

      // 3. Process initial embed queue in background (may take a long time)
      this.processInitialEmbedQueue().catch(e => {
        console.error('Background embedding failed:', e);
      });

    } catch (e) {
      this.init_errors.push({ phase: 'initializeEmbedding', error: e as Error });
      console.error('Failed to initialize embedding (Phase 2):', e);

      // Update status bar to show error
      this.status_state = 'error';
      this.refreshStatus();

      // Don't rethrow — Phase 1 is already working
    }
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
  }

  async saveSettings(): Promise<void> {
    const data = await this.loadData() || {};
    data.settings = this.settings;
    await this.saveData(data);
  }

  async loadUserState(): Promise<void> {
    this._installed_at = null;
    const data = await this.loadData();

    // Migrate from localStorage if needed
    if (this.migrateInstalledAtFromLocalStorage()) return;

    if (data && typeof data.installed_at !== 'undefined') {
      this._installed_at = data.installed_at;
    }

    // Determine installed_at from data.json ctime if not set
    const dataCtime = await this.getDataJsonCreatedAt();
    const resolved = determine_installed_at(this._installed_at, dataCtime);
    if (typeof resolved === 'number' && resolved !== this._installed_at) {
      await this.saveInstalledAt(resolved);
    }
  }

  async getDataJsonCreatedAt(): Promise<number | null> {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
      const stat = await this.app.vault.adapter.stat(path);
      return stat?.ctime ?? null;
    } catch (error) {
      return null;
    }
  }

  migrateInstalledAtFromLocalStorage(): boolean {
    const key = 'smart_connections_new_user';
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null) {
      const oldValue = localStorage.getItem(key) !== 'false';
      if (!oldValue) {
        this._installed_at = Date.now();
        this.saveInstalledAt(this._installed_at);
      }
      localStorage.removeItem(key);
      return true;
    }
    return false;
  }

  async saveInstalledAt(value: number): Promise<void> {
    this._installed_at = value;
    const data = (await this.loadData()) || {};
    data.installed_at = value;
    if ('new_user' in data) delete data.new_user;
    await this.saveData(data);
  }

  isNewUser(): boolean {
    return !this._installed_at;
  }

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

  async initEmbedModel(): Promise<void> {
    try {
      const embedSettings = this.settings.smart_sources.embed_model;
      const adapterType = embedSettings.adapter;

      // Get adapter-specific settings
      const adapterSettings = this.getEmbedAdapterSettings(embedSettings);
      const modelKey = adapterSettings.model_key || '';

      console.log(`Initializing embed model: ${adapterType}/${modelKey}`);

      // Create adapter based on type
      let adapter: any;

      switch (adapterType) {
        case 'transformers': {
          const modelInfo = TRANSFORMERS_EMBED_MODELS[modelKey];
          if (!modelInfo) {
            throw new Error(`Unknown transformers model: ${modelKey}`);
          }

          adapter = new TransformersEmbedAdapter({
            adapter: 'transformers',
            model_key: modelKey,
            dims: modelInfo.dims ?? 384,
            models: TRANSFORMERS_EMBED_MODELS,
            settings: adapterSettings,
          });

          // Load the worker
          await adapter.load();
          break;
        }

        case 'openai': {
          const modelInfo = OPENAI_EMBED_MODELS[modelKey];
          if (!modelInfo) {
            throw new Error(`Unknown OpenAI model: ${modelKey}`);
          }

          adapter = new OpenAIEmbedAdapter({
            adapter: 'openai',
            model_key: modelKey,
            dims: modelInfo.dims ?? 1536,
            models: OPENAI_EMBED_MODELS,
            settings: adapterSettings,
          });
          break;
        }

        case 'ollama': {
          adapter = new OllamaEmbedAdapter({
            adapter: 'ollama',
            model_key: modelKey,
            dims: adapterSettings.dims || 384,
            models: {},
            settings: adapterSettings,
          });
          break;
        }

        case 'gemini': {
          const modelInfo = GEMINI_EMBED_MODELS[modelKey];
          if (!modelInfo) {
            throw new Error(`Unknown Gemini model: ${modelKey}`);
          }

          adapter = new GeminiEmbedAdapter({
            adapter: 'gemini',
            model_key: modelKey,
            dims: modelInfo.dims ?? 768,
            models: GEMINI_EMBED_MODELS,
            settings: adapterSettings,
          });
          break;
        }

        case 'lm_studio': {
          adapter = new LmStudioEmbedAdapter({
            adapter: 'lm_studio',
            model_key: modelKey,
            dims: adapterSettings.dims || 384,
            models: {},
            settings: adapterSettings,
          });
          break;
        }

        case 'upstage': {
          const modelInfo = UPSTAGE_EMBED_MODELS[modelKey];
          if (!modelInfo) {
            throw new Error(`Unknown Upstage model: ${modelKey}`);
          }

          adapter = new UpstageEmbedAdapter({
            adapter: 'upstage',
            model_key: modelKey,
            dims: modelInfo.dims ?? 4096,
            models: UPSTAGE_EMBED_MODELS,
            settings: adapterSettings,
          });
          break;
        }

        case 'open_router': {
          adapter = new OpenRouterEmbedAdapter({
            adapter: 'open_router',
            model_key: modelKey,
            dims: adapterSettings.dims || 1536,
            models: {},
            settings: adapterSettings,
          });
          break;
        }

        default:
          throw new Error(`Unknown embed adapter: ${adapterType}`);
      }

      // Create EmbedModel wrapper
      this.embed_model = new EmbedModel({
        adapter,
        model_key: modelKey,
        settings: this.settings,
      });

      console.log('Embed model initialized successfully');
    } catch (error) {
      console.error('Failed to initialize embed model:', error);
      new Notice('Smart Connections: Failed to initialize embedding model');
      throw error;
    }
  }

  syncCollectionEmbeddingContext(): void {
    const modelKey = this.embed_model?.model_key;
    const modelDims = this.embed_model?.adapter?.dims;

    if (this.source_collection) {
      if (modelKey) this.source_collection.embed_model_key = modelKey;
      this.source_collection.embed_model_dims = modelDims;
    }

    if (this.block_collection) {
      if (modelKey) this.block_collection.embed_model_key = modelKey;
      this.block_collection.embed_model_dims = modelDims;
    }
  }

  private getEmbedAdapterSettings(embedSettings?: Record<string, any>): Record<string, any> {
    if (!embedSettings) return {};
    const adapterType = embedSettings.adapter;
    if (typeof adapterType !== 'string' || adapterType.length === 0) return {};
    const settings = embedSettings[adapterType];
    return settings && typeof settings === 'object' ? settings : {};
  }

  queueUnembeddedEntities(): number {
    let queued = 0;

    if (this.source_collection) {
      for (const source of this.source_collection.all) {
        if (!source.is_unembedded) continue;
        const was_queued = source._queue_embed;
        source.queue_embed();
        if (!was_queued && source._queue_embed) queued++;
      }
    }

    if (this.block_collection) {
      for (const block of this.block_collection.all) {
        if (!block.is_unembedded) continue;
        const was_queued = block._queue_embed;
        block.queue_embed();
        if (!was_queued && block._queue_embed) queued++;
      }
    }

    return queued;
  }

  requestEmbeddingStop(reason: string = 'User requested stop'): boolean {
    if (!this.embedding_pipeline?.is_active()) {
      return false;
    }

    console.log(`Stopping embedding pipeline: ${reason}`);
    this.embedding_pipeline.halt();
    this.status_state = 'paused';
    this.refreshStatus();
    new Notice('Smart Connections: Stopping embedding...');
    return true;
  }

  async waitForEmbeddingToStop(timeoutMs: number = 30000): Promise<boolean> {
    if (!this.embedding_pipeline?.is_active()) return true;

    const start = Date.now();
    while (this.embedding_pipeline?.is_active()) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return true;
  }

  async initCollections(): Promise<void> {
    try {
      const dataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}/.smart-env`;
      const adapterSettings = this.getEmbedAdapterSettings(
        this.settings.smart_sources.embed_model as unknown as Record<string, any>,
      );
      const modelKey =
        this.embed_model?.model_key || adapterSettings.model_key || 'None';

      console.log(`Initializing collections with data dir: ${dataDir}`);

      // Create source collection — pass vault.adapter for FS operations
      this.source_collection = new SourceCollection(
        `${dataDir}/sources`,
        this.settings.smart_sources,
        modelKey,
        this.app.vault,
        this.app.metadataCache,
      );

      // Create block collection
      this.block_collection = new BlockCollection(
        `${dataDir}/blocks`,
        this.settings.smart_blocks,
        modelKey,
        this.source_collection,
      );

      // Link collections
      this.source_collection.block_collection = this.block_collection;

      // Initialize collections
      await this.source_collection.init();
      await this.block_collection.init();

      console.log('Collections initialized successfully');
    } catch (error) {
      console.error('Failed to initialize collections:', error);
      throw error;
    }
  }

  async loadCollections(): Promise<void> {
    try {
      if (!this.source_collection || !this.block_collection) {
        throw new Error('Collections must be initialized before loading');
      }

      console.log('Loading collections from storage...');

      // Load source collection
      await this.source_collection.data_adapter.load();
      this.source_collection.loaded = true;

      // Load block collection
      await this.block_collection.data_adapter.load();
      this.block_collection.loaded = true;

      const sourceCount = Object.keys(this.source_collection.items).length;
      const blockCount = Object.keys(this.block_collection.items).length;

      console.log(`Collections loaded: ${sourceCount} sources, ${blockCount} blocks`);
    } catch (error) {
      console.error('Failed to load collections:', error);
      new Notice('Smart Connections: Failed to load collection data');
      throw error;
    }
  }

  async initPipeline(): Promise<void> {
    try {
      if (!this.embed_model) {
        throw new Error('Embed model must be initialized before pipeline');
      }

      console.log('Initializing embedding pipeline...');

      // Create embedding pipeline with the adapter
      this.embedding_pipeline = new EmbeddingPipeline(this.embed_model.adapter);

      // Set up progress callbacks
      const onProgress = (current: number, total: number) => {
        if (this.status_msg) {
          this.status_msg.setText(`Embedding ${current}/${total}`);
        }
      };

      const onBatchComplete = (batch_num: number, batch_size: number) => {
        console.log(`Completed batch ${batch_num} (${batch_size} items)`);
      };

      console.log('Embedding pipeline initialized successfully');
    } catch (error) {
      console.error('Failed to initialize pipeline:', error);
      new Notice('Smart Connections: Failed to initialize embedding pipeline');
      throw error;
    }
  }

  async processInitialEmbedQueue(): Promise<void> {
    if (!this.source_collection || !this.embedding_pipeline) return;

    // Get entities needing embedding
    const sourcesToEmbed = this.source_collection.embed_queue;
    const blocksToEmbed = this.block_collection?.embed_queue || [];
    const entitiesToEmbed = [...sourcesToEmbed, ...blocksToEmbed];

    if (entitiesToEmbed.length === 0) {
      console.log('No entities need embedding');
      return;
    }

    console.log(`Processing initial embed queue: ${entitiesToEmbed.length} entities`);

    this.status_state = 'embedding';
    this.refreshStatus();

    new Notice(`Smart Connections: Embedding ${entitiesToEmbed.length} notes...`);

    let lastMilestone = 0;
    try {
      const stats = await this.embedding_pipeline.process(entitiesToEmbed, {
        batch_size: 10,
        on_progress: (current, total) => {
          if (this.status_msg) {
            this.status_msg.setText(`SC: Embedding ${current}/${total}`);
          }
          // Emit progress event for ConnectionsView
          this.app.workspace.trigger('smart-connections:embed-progress' as any, { current, total });
          // Milestone notices every 1000
          const milestone = Math.floor(current / 1000) * 1000;
          if (milestone > lastMilestone && milestone > 0) {
            lastMilestone = milestone;
            new Notice(`SC: ${milestone} / ${total} embedded`);
          }
        },
        on_save: async () => {
          // Periodic save during embedding
          await this.source_collection!.data_adapter.save();
          if (this.block_collection) {
            await this.block_collection.data_adapter.save();
          }
        },
        save_interval: 50,
      });

      console.log('Initial embedding stats:', stats);
      new Notice(`Smart Connections: Embedding complete! ${stats.success} notes embedded.`);

      // Final save after embedding
      await this.source_collection.data_adapter.save();
      if (this.block_collection) {
        await this.block_collection.data_adapter.save();
      }
    } catch (error) {
      console.error('Initial embedding failed:', error);
      new Notice('Smart Connections: Embedding failed. See console for details.');
      throw error;
    } finally {
      const final_stats = this.embedding_pipeline.get_stats();

      // Emit completion so ConnectionsView can hide the progress bar even on errors.
      this.app.workspace.trigger('smart-connections:embed-progress' as any, {
        current: final_stats.success + final_stats.failed + final_stats.skipped,
        total: final_stats.total,
        done: true,
      });

      this.status_state = 'idle';
      this.refreshStatus();
    }
  }

  registerFileWatchers(): void {
    // File created
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && this.isSourceFile(file)) {
          this.queueSourceReImport(file.path);
        }
      }),
    );

    // File renamed
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && this.isSourceFile(file)) {
          this.queueSourceReImport(file.path);
        }
        if (oldPath) {
          this.removeSource(oldPath);
        }
      }),
    );

    // File modified
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.isSourceFile(file)) {
          this.queueSourceReImport(file.path);
        }
      }),
    );

    // File deleted
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && this.isSourceFile(file)) {
          this.removeSource(file.path);
        }
      }),
    );

    // Editor changed (debounced re-import)
    this.registerEvent(
      this.app.workspace.on('editor-change', () => {
        this.debounceReImport();
      }),
    );

    // Active leaf changed (debounced re-import)
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.debounceReImport();
      }),
    );
  }

  isSourceFile(file: TFile): boolean {
    // Check if file has a supported extension
    const supportedExtensions = ['md', 'txt'];
    return supportedExtensions.some((ext) => file.path.endsWith(`.${ext}`));
  }

  queueSourceReImport(path: string): void {
    if (!this.re_import_queue[path]) {
      this.re_import_queue[path] = { path, queued_at: Date.now() };
      this.debounceReImport();
    }
  }

  removeSource(path: string): void {
    delete this.re_import_queue[path];

    // Remove from collections
    if (this.source_collection) {
      this.source_collection.delete(path);
    }

    // Remove blocks
    if (this.block_collection) {
      this.block_collection.delete_source_blocks(path);
    }
  }

  debounceReImport(): void {
    this.re_import_halted = true;
    if (this.re_import_timeout) {
      window.clearTimeout(this.re_import_timeout);
    }
    if (this.re_import_retry_timeout) {
      window.clearTimeout(this.re_import_retry_timeout);
      this.re_import_retry_timeout = undefined;
    }

    const waitTime = (this.settings.re_import_wait_time || 13) * 1000;
    this.re_import_timeout = window.setTimeout(() => {
      this.runReImport();
    }, waitTime);

    this.refreshStatus();
  }

  private deferReImport(reason: string, delayMs: number = 1500): void {
    console.log(`${reason}. Deferring re-import for ${delayMs}ms...`);
    if (this.re_import_retry_timeout) {
      window.clearTimeout(this.re_import_retry_timeout);
    }
    this.re_import_retry_timeout = window.setTimeout(() => {
      this.re_import_retry_timeout = undefined;
      void this.runReImport();
    }, delayMs);
  }

  async runReImport(): Promise<void> {
    this.re_import_halted = false;

    if (!this.source_collection || !this.embedding_pipeline) {
      console.warn('Collections or pipeline not initialized');
      return;
    }

    // Prevent concurrent embedding pipeline execution.
    if (this.embedding_pipeline.is_active()) {
      if (this.status_msg) {
        this.status_msg.setText('SC: Embedding in progress, updates queued');
      }
      this.deferReImport('Embedding pipeline is already processing');
      return;
    }

    const queue_paths = Object.keys(this.re_import_queue);
    if (queue_paths.length === 0) return;

    console.log(`Re-importing ${queue_paths.length} sources...`);
    const processed_paths: string[] = [];

    try {
      // Update status
      if (this.status_msg) {
        this.status_msg.setText(`Processing ${queue_paths.length} files...`);
      }

      // Process each queued source
      for (const path of queue_paths) {
        if (this.re_import_halted) {
          console.log('Re-import halted by user');
          break;
        }

        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          // Import source (this will update metadata and queue embedding)
          await this.source_collection.import_source(file);
        }
        processed_paths.push(path);
      }

      // Get all entities that need embedding
      const sourcesToEmbed = this.source_collection.embed_queue;
      const blocksToEmbed = this.block_collection?.embed_queue || [];
      const entitiesToEmbed = [...sourcesToEmbed, ...blocksToEmbed];

      console.log(`Embedding ${entitiesToEmbed.length} entities...`);

      // Run embedding pipeline
      if (entitiesToEmbed.length > 0) {
        const stats = await this.embedding_pipeline.process(entitiesToEmbed, {
          batch_size: 10,
          max_retries: 3,
          on_progress: (current, total) => {
            if (this.status_msg) {
              this.status_msg.setText(`Embedding ${current}/${total}`);
            }
          },
          on_batch_complete: (batch_num, batch_size) => {
            console.log(`Completed batch ${batch_num} (${batch_size} items)`);
          },
        });

        console.log('Embedding stats:', stats);

        new Notice(`Smart Connections: Re-import complete! ${stats.success} notes embedded.`);

        // Save collections after embedding
        await this.source_collection.data_adapter.save();
        if (this.block_collection) {
          await this.block_collection.data_adapter.save();
        }
      }

      // Remove only processed paths. New items queued during this run must stay in queue.
      processed_paths.forEach((path) => {
        if (this.re_import_queue[path]) {
          delete this.re_import_queue[path];
        }
      });

      // Refresh status
      this.refreshStatus();

      console.log('Re-import completed');

      if (Object.keys(this.re_import_queue).length > 0) {
        this.deferReImport('Re-import queue still has pending updates');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Embedding pipeline is already processing')
      ) {
        this.deferReImport('Embedding pipeline is already processing');
        return;
      }
      console.error('Re-import failed:', error);
      new Notice('Smart Connections: Re-import failed. See console for details.');
      this.refreshStatus();
    }
  }

  setupStatusBar(): void {
    const app_any = this.app as any;
    const status_bar_container: HTMLElement | undefined = app_any?.statusBar?.containerEl;
    if (!status_bar_container) return;

    const existing = status_bar_container.querySelector('.smart-connections-status');
    if (existing) {
      existing.closest('.status-bar-item')?.remove();
    }

    this.status_elm = this.addStatusBarItem();
    this.status_container = this.status_elm.createEl('a', {
      cls: 'smart-connections-status',
    });
    setIcon(this.status_container, 'network');

    this.status_msg = this.status_container.createSpan('smart-connections-status-msg');

    this.registerDomEvent(this.status_container, 'click', () => this.handleStatusBarClick());

    this.refreshStatus();
  }

  refreshStatus(): void {
    if (!this.status_msg || !this.status_container) return;

    switch (this.status_state) {
      case 'idle':
        this.status_msg.setText('SC: Ready');
        this.status_container.setAttribute('title', 'Smart Connections is ready');
        break;
      case 'loading_model':
        this.status_msg.setText('SC: Loading model...');
        this.status_container.setAttribute('title', 'Loading embedding model...');
        break;
      case 'embedding': {
        const stats = this.embedding_pipeline?.get_stats();
        const current = stats ? stats.success + stats.failed : 0;
        const total = stats?.total || 0;
        this.status_msg.setText(`SC: Embedding ${current}/${total}`);
        this.status_container.setAttribute('title', 'Click to pause embedding');
        break;
      }
      case 'paused':
        this.status_msg.setText('SC: Paused');
        this.status_container.setAttribute('title', 'Click to resume embedding');
        break;
      case 'error':
        this.status_msg.setText('SC: Error');
        this.status_container.setAttribute('title', 'Click to open settings');
        break;
    }
  }

  handleStatusBarClick(): void {
    switch (this.status_state) {
      case 'embedding':
        this.requestEmbeddingStop('Status bar click');
        break;
      case 'paused':
        // Resume embedding — re-trigger the embed queue
        this.status_state = 'embedding';
        this.refreshStatus();
        this.runReImport();
        break;
      case 'error':
        // Open settings
        (this.app as any).setting?.open?.();
        break;
      default:
        // Open connections view
        ConnectionsView.open(this.app.workspace);
        break;
    }
  }

  async handleNewUser(): Promise<void> {
    if (!this.isNewUser()) return;

    await this.saveInstalledAt(Date.now());
    await this.setLastKnownVersion(this.manifest.version);

    // Open connections view after a delay
    setTimeout(() => {
      ConnectionsView.open(this.app.workspace);
    }, 1000);

    // Expand right sidebar if collapsed
    if ((this.app.workspace as any).rightSplit?.collapsed) {
      (this.app.workspace as any).rightSplit?.toggle();
    }

    // Add .smart-env to .gitignore
    await this.addToGitignore('\n\n# Ignore Smart Environment folder\n.smart-env');
  }

  async checkForUpdates(): Promise<void> {
    // Check for release notes
    if (await this.shouldShowReleaseNotes(this.manifest.version)) {
      await this.setLastKnownVersion(this.manifest.version);
    }

    // Check for updates after 3 seconds
    setTimeout(() => this.checkForUpdate(), 3000);

    // Check for updates every 3 hours
    setInterval(() => this.checkForUpdate(), 10800000);
  }

  async checkForUpdate(): Promise<void> {
    try {
      const { json: response } = await requestUrl({
        url: 'https://api.github.com/repos/GoBeromsu/obsidian-smart-connections/releases/latest',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        contentType: 'application/json',
      });

      if (response.tag_name !== this.manifest.version) {
        new Notice(`Smart Connections: Update available (${response.tag_name})`);
      }
    } catch (error) {
      // Silent failure
    }
  }

  async getLastKnownVersion(): Promise<string> {
    const data = (await this.loadData()) || {};
    return data.last_version || '';
  }

  async setLastKnownVersion(version: string): Promise<void> {
    const data = (await this.loadData()) || {};
    data.last_version = version;
    await this.saveData(data);
  }

  async shouldShowReleaseNotes(currentVersion: string): Promise<boolean> {
    return (await this.getLastKnownVersion()) !== currentVersion;
  }

  async addToGitignore(ignore: string, message: string | null = null): Promise<void> {
    if (!(await this.app.vault.adapter.exists('.gitignore'))) return;

    const gitignore = await this.app.vault.adapter.read('.gitignore');
    if (gitignore.indexOf(ignore) < 0) {
      await this.app.vault.adapter.append(
        '.gitignore',
        `\n\n${message ? '# ' + message + '\n' : ''}${ignore}`,
      );
    }
  }

  async open_note(targetPath: string, event: MouseEvent | null = null): Promise<void> {
    // Open note using Obsidian's navigation
    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (file instanceof TFile) {
      const mode = event?.ctrlKey || event?.metaKey ? 'tab' : 'source';
      await this.app.workspace.getLeaf(mode === 'tab').openFile(file);
    }
  }

  async onunload(): Promise<void> {
    console.log('Unloading Smart Connections plugin');

    // Clear timeouts
    if (this.re_import_timeout) {
      window.clearTimeout(this.re_import_timeout);
    }
    if (this.re_import_retry_timeout) {
      window.clearTimeout(this.re_import_retry_timeout);
    }

    // Unload embed model (especially for transformers worker)
    if (this.embed_model) {
      await this.embed_model.unload();
    }

    // Unload environment
    this.env?.unload?.();
  }
}
