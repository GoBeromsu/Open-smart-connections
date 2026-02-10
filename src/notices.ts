/**
 * @file notices.ts
 * @description Centralized notice management with mute/unmute support
 */

import { Notice, setIcon } from 'obsidian';
import type SmartConnectionsPlugin from './main';

type NoticeParams = Record<string, unknown>;

interface NoticeButtonConfig {
  text: string;
  callback: () => void | Promise<void>;
  stayOpen?: boolean;
}

interface NoticeDefinition {
  text: string;
  timeout?: number;
  immutable?: boolean;
}

interface NoticeShowOptions {
  button?: NoticeButtonConfig;
  timeout?: number;
  immutable?: boolean;
  text?: string;
}

const NOTICE_CATALOG: Record<string, NoticeDefinition> = {
  notice_muted: {
    text: 'Smart Connections: Notice muted.',
    timeout: 2000,
    immutable: true,
  },
  embedding_progress: {
    text: 'Smart Connections: {{adapter}}/{{modelKey}} {{current}}/{{total}} ({{percent}}%)',
    timeout: 0,
  },
  embedding_complete: {
    text: 'Smart Connections: Embedding complete! {{success}} notes embedded.',
  },
  embedding_failed: {
    text: 'Smart Connections: Embedding failed. See console for details.',
  },
  failed_init_embed_model: {
    text: 'Smart Connections: Failed to initialize embedding model',
  },
  failed_download_transformers_model: {
    text: 'Smart Connections: Failed to download transformers model assets. Check network/CDN access and retry.',
  },
  failed_init_embed_pipeline: {
    text: 'Smart Connections: Failed to initialize embedding pipeline',
  },
  failed_load_collection_data: {
    text: 'Smart Connections: Failed to load collection data',
  },
  reimport_failed: {
    text: 'Smart Connections: Re-import failed. See console for details.',
  },
  update_available: {
    text: 'Smart Connections: Update available ({{tag_name}})',
  },
  no_stale_entities: {
    text: 'No stale entities to re-embed.',
  },
  reinitializing_embedding_model: {
    text: 'Smart Connections: Re-initializing embedding model...',
  },
  embedding_model_switched: {
    text: 'Smart Connections: Embedding model switched.',
  },
  failed_reinitialize_model: {
    text: 'Smart Connections: Failed to re-initialize model. Check console.',
  },
  restart_plugin_chat: {
    text: 'Smart Connections: Restart plugin for chat changes to take effect.',
  },
};

export class SmartConnectionsNotices {
  private plugin: SmartConnectionsPlugin;
  private active: Record<string, Notice> = {};
  private activeTimers: Record<string, number> = {};
  private themeObserver: MutationObserver | null = null;

  constructor(plugin: SmartConnectionsPlugin) {
    this.plugin = plugin;
    this.startThemeSync();
  }

  normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  has(id: string): boolean {
    const normalized = this.normalizeKey(id);
    return !!this.active[normalized];
  }

  isMuted(id: string): boolean {
    const normalized = this.normalizeKey(id);
    const muted = this.getMutedStore();
    return muted[normalized] === true;
  }

  async mute(id: string): Promise<void> {
    const normalized = this.normalizeKey(id);
    const muted = this.getMutedStore();
    muted[normalized] = true;
    await this.plugin.saveSettings();
  }

  async unmute(id: string): Promise<void> {
    const normalized = this.normalizeKey(id);
    const muted = this.getMutedStore();
    if (muted[normalized]) {
      delete muted[normalized];
      await this.plugin.saveSettings();
    }
  }

  async unmuteAll(): Promise<void> {
    const muted = this.getMutedStore();
    const hasMuted = Object.keys(muted).length > 0;
    if (!hasMuted) return;
    this.plugin.settings.smart_notices.muted = {};
    await this.plugin.saveSettings();
  }

  listMuted(): string[] {
    const muted = this.getMutedStore();
    return Object.keys(muted)
      .filter((key) => muted[key] === true)
      .sort();
  }

  show(id: string, params: NoticeParams = {}, opts: NoticeShowOptions = {}): Notice | null {
    const normalized = this.normalizeKey(id);
    if (this.isMuted(normalized)) return null;

    const definition = NOTICE_CATALOG[id];
    const template = opts.text ?? definition?.text ?? id;
    const timeout = opts.timeout ?? definition?.timeout ?? 5000;
    const immutable = opts.immutable ?? definition?.immutable ?? false;
    const message = this.interpolate(template, params);
    const fragment = this.buildFragment(id, normalized, message, {
      button: opts.button,
      immutable,
    });

    const existing = this.active[normalized];
    if (existing) {
      existing.setMessage(fragment);
      this.applyNoticeTheme(existing);
      this.scheduleCleanup(normalized, timeout);
      return existing;
    }

    const notice = new Notice(fragment, timeout);
    this.applyNoticeTheme(notice);
    this.active[normalized] = notice;
    this.scheduleCleanup(normalized, timeout);
    return notice;
  }

  remove(id: string): void {
    const normalized = this.normalizeKey(id);
    this.active[normalized]?.hide();
    delete this.active[normalized];
    if (this.activeTimers[normalized]) {
      window.clearTimeout(this.activeTimers[normalized]);
      delete this.activeTimers[normalized];
    }
  }

  unload(): void {
    for (const key of Object.keys(this.active)) {
      this.remove(key);
    }
    this.stopThemeSync();
  }

  private getMutedStore(): Record<string, boolean> {
    if (!this.plugin.settings.smart_notices || typeof this.plugin.settings.smart_notices !== 'object') {
      this.plugin.settings.smart_notices = { muted: {} };
    }
    if (!this.plugin.settings.smart_notices.muted || typeof this.plugin.settings.smart_notices.muted !== 'object') {
      this.plugin.settings.smart_notices.muted = {};
    }
    return this.plugin.settings.smart_notices.muted;
  }

  private interpolate(template: string, params: NoticeParams): string {
    return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => {
      const value = params[key];
      if (value === null || value === undefined) return '';
      return String(value);
    });
  }

  private buildFragment(
    id: string,
    normalizedId: string,
    text: string,
    opts: { button?: NoticeButtonConfig; immutable: boolean },
  ): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'osc-notice';

    const head = document.createElement('p');
    head.className = 'osc-notice-head';
    head.textContent = '[Smart Connections]';
    wrapper.appendChild(head);

    const body = document.createElement('p');
    body.className = 'osc-notice-content';
    body.textContent = text;
    wrapper.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'osc-notice-actions';

    if (opts.button?.text && typeof opts.button.callback === 'function') {
      const button = this.createActionButton(opts.button.text, async () => {
        await opts.button?.callback();
        if (!opts.button?.stayOpen) this.remove(normalizedId);
      });
      actions.appendChild(button);
    }

    if (!opts.immutable) {
      const muteButton = this.createMuteButton(id, normalizedId);
      actions.appendChild(muteButton);
    }

    if (actions.childElementCount > 0) {
      wrapper.appendChild(actions);
    }

    fragment.appendChild(wrapper);
    return fragment;
  }

  private createActionButton(text: string, callback: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'osc-notice-btn';
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => {
      void callback();
    });
    return button;
  }

  private createMuteButton(id: string, normalizedId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'osc-notice-btn osc-notice-btn--mute';
    button.type = 'button';
    button.setAttribute('aria-label', `Mute notice: ${id}`);
    setIcon(button, 'bell-off');
    button.addEventListener('click', () => {
      void this.mute(normalizedId)
        .then(() => {
          this.remove(normalizedId);
          this.show('notice_muted', {}, { immutable: true, timeout: 2000 });
        })
        .catch((error) => {
          console.error('Failed to mute notice:', error);
        });
    });
    return button;
  }

  private scheduleCleanup(id: string, timeout: number): void {
    if (this.activeTimers[id]) {
      window.clearTimeout(this.activeTimers[id]);
      delete this.activeTimers[id];
    }
    if (timeout <= 0) return;
    this.activeTimers[id] = window.setTimeout(() => {
      delete this.active[id];
      delete this.activeTimers[id];
    }, timeout + 50);
  }

  private startThemeSync(): void {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    if (!document.body || this.themeObserver) return;
    this.themeObserver = new MutationObserver(() => {
      this.syncActiveNoticeThemes();
    });
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private stopThemeSync(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }

  private syncActiveNoticeThemes(): void {
    for (const notice of Object.values(this.active)) {
      this.applyNoticeTheme(notice);
    }
  }

  private applyNoticeTheme(notice: Notice): void {
    const host = ((notice as any).containerEl || (notice as any).noticeEl) as HTMLElement | undefined;
    if (!host) return;
    const theme = this.getCurrentTheme();
    host.classList.add('osc-notice-host');
    host.setAttribute('data-osc-theme', theme);
  }

  private getCurrentTheme(): 'light' | 'dark' {
    if (typeof document === 'undefined') return 'light';
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }
}

export default SmartConnectionsNotices;
