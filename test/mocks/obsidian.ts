/**
 * @file obsidian.ts
 * @description Mock implementations of Obsidian API for Vitest tests
 */

import { vi } from 'vitest';

/**
 * Mock TFile
 */
export class TFile {
  path: string;
  basename: string;
  extension: string;
  stat: { mtime: number; size: number };
  vault: any;

  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    const dotIndex = filename.lastIndexOf('.');
    this.basename = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
    this.extension = dotIndex >= 0 ? filename.substring(dotIndex + 1) : '';
    this.stat = { mtime: Date.now(), size: 1000 };
  }
}

/**
 * Mock TFolder
 */
export class TFolder {
  path: string;
  name: string;
  children: (TFile | TFolder)[];

  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    this.name = parts[parts.length - 1];
    this.children = [];
  }
}

/**
 * Mock Vault
 */
export class Vault {
  files: Map<string, TFile> = new Map();

  async read(file: TFile): Promise<string> {
    return `Mock content for ${file.path}`;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.files.get(path) || null;
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values()).filter(f => f.extension === 'md');
  }

  on = vi.fn();
  off = vi.fn();
}

/**
 * Mock MetadataCache
 */
export class MetadataCache {
  cache: Map<string, any> = new Map();

  getFileCache(file: TFile): any {
    return this.cache.get(file.path) || {
      headings: [],
      links: [],
      tags: [],
    };
  }

  on = vi.fn();
  off = vi.fn();
}

/**
 * Mock Workspace
 */
export class Workspace {
  activeLeaf: any = null;

  getActiveFile(): TFile | null {
    return null;
  }

  getLeavesOfType(type: string): any[] {
    return [];
  }

  getLeaf(newLeaf?: boolean): any {
    return {
      view: {},
      setViewState: vi.fn(),
    };
  }

  on = vi.fn();
  off = vi.fn();
}

/**
 * Mock App
 */
export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
  plugins: any = {
    plugins: {},
    enabledPlugins: new Set(),
  };

  constructor() {
    // Add some default files
    const file1 = new TFile('Test Note.md');
    const file2 = new TFile('Another Note.md');
    this.vault.files.set('Test Note.md', file1);
    this.vault.files.set('Another Note.md', file2);
  }
}

/**
 * Mock Plugin
 */
export class Plugin {
  app: App;
  manifest: any;

  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand = vi.fn();
  addRibbonIcon = vi.fn();
  addSettingTab = vi.fn();
  registerView = vi.fn();
  registerEvent = vi.fn();
  loadData = vi.fn().mockResolvedValue({});
  saveData = vi.fn().mockResolvedValue(undefined);
}

/**
 * Mock PluginSettingTab
 */
export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement = document.createElement('div');

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {}
  hide(): void {}
}

/**
 * Mock ItemView
 */
export class ItemView {
  app: App;
  containerEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');

  constructor(leaf: any) {
    this.app = new App();
  }

  getViewType(): string {
    return 'mock-view';
  }

  getDisplayText(): string {
    return 'Mock View';
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

/**
 * Mock Component
 */
export class Component {
  _loaded: boolean = false;

  load(): void {
    this._loaded = true;
  }

  unload(): void {
    this._loaded = false;
  }

  addChild<T extends Component>(component: T): T {
    return component;
  }

  removeChild<T extends Component>(component: T): T {
    return component;
  }

  register(cb: () => any): void {
    cb();
  }

  registerEvent(eventRef: any): void {}
}

/**
 * Mock Modal
 */
export class Modal extends Component {
  app: App;
  containerEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');

  constructor(app: App) {
    super();
    this.app = app;
  }

  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

/**
 * Mock Notice
 */
export class Notice {
  message: string;
  duration: number;

  constructor(message: string, duration?: number) {
    this.message = message;
    this.duration = duration || 5000;
  }

  setMessage(message: string | DocumentFragment): this {
    this.message = typeof message === 'string' ? message : message.textContent || '';
    return this;
  }

  hide(): void {}
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
    containerEl.appendChild(this.buttonEl);
  }

  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add('mod-cta');
    return this;
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setClass(cls: string): this {
    this.buttonEl.classList.add(...cls.split(' ').filter(Boolean));
    return this;
  }

  onClick(callback: (evt: MouseEvent) => unknown | Promise<unknown>): this {
    this.buttonEl.addEventListener('click', (evt) => {
      void callback(evt as MouseEvent);
    });
    return this;
  }
}

export class ProgressBarComponent {
  progressEl: HTMLElement;
  private value = 0;

  constructor(containerEl: HTMLElement) {
    this.progressEl = document.createElement('div');
    this.progressEl.className = 'mock-progress-bar';
    containerEl.appendChild(this.progressEl);
  }

  getValue(): number {
    return this.value;
  }

  setValue(value: number): this {
    this.value = value;
    this.progressEl.setAttribute('data-value', String(value));
    return this;
  }
}

export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.setAttribute('data-icon', iconId);
}

/**
 * Mock MarkdownRenderer
 */
export const MarkdownRenderer = {
  renderMarkdown: vi.fn((markdown: string, el: HTMLElement, sourcePath: string, component: Component) => {
    el.innerHTML = markdown;
    return Promise.resolve();
  }),
};

/**
 * Mock requestUrl
 */
export const requestUrl = vi.fn((request: any) => {
  return Promise.resolve({
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: {},
    text: '',
  });
});

/**
 * Mock normalizePath
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Export all mocks
 */
export default {
  App,
  Plugin,
  PluginSettingTab,
  ItemView,
  Component,
  Modal,
  Notice,
  ButtonComponent,
  ProgressBarComponent,
  setIcon,
  TFile,
  TFolder,
  Vault,
  MetadataCache,
  Workspace,
  MarkdownRenderer,
  requestUrl,
  normalizePath,
};
