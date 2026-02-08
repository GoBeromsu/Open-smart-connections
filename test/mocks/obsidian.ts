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
  message: string | DocumentFragment;
  duration: number;
  noticeEl: HTMLElement;
  containerEl: HTMLElement;
  messageEl: HTMLElement;
  hidden = false;

  constructor(message: string | DocumentFragment, duration?: number) {
    this.duration = duration || 5000;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'notice';
    this.noticeEl = this.containerEl;
    this.messageEl = document.createElement('div');
    this.messageEl.className = 'notice-message';
    this.containerEl.appendChild(this.messageEl);
    this.setMessage(message);
  }

  setMessage(message: string | DocumentFragment): this {
    this.message = message;
    this.messageEl.textContent = '';
    if (typeof message === 'string') {
      this.messageEl.textContent = message;
    } else {
      this.messageEl.appendChild(message.cloneNode(true));
    }
    return this;
  }

  hide(): void {
    this.hidden = true;
  }
}

export class DropdownComponent {
  options: Array<{ value: string; label: string }> = [];
  value: string = '';
  private changeHandler?: (value: string) => unknown | Promise<unknown>;

  addOption(value: string, label: string): this {
    this.options.push({ value, label });
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(handler: (value: string) => unknown | Promise<unknown>): this {
    this.changeHandler = handler;
    return this;
  }

  async trigger(value: string): Promise<void> {
    this.value = value;
    await this.changeHandler?.(value);
  }
}

export class TextComponent {
  inputEl: HTMLInputElement = document.createElement('input');
  value = '';
  private changeHandler?: (value: string) => unknown | Promise<unknown>;

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    this.inputEl.value = value;
    return this;
  }

  onChange(handler: (value: string) => unknown | Promise<unknown>): this {
    this.changeHandler = handler;
    return this;
  }

  async trigger(value: string): Promise<void> {
    this.value = value;
    this.inputEl.value = value;
    await this.changeHandler?.(value);
  }
}

export class ToggleComponent {
  value = false;
  private changeHandler?: (value: boolean) => unknown | Promise<unknown>;

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(handler: (value: boolean) => unknown | Promise<unknown>): this {
    this.changeHandler = handler;
    return this;
  }

  async trigger(value: boolean): Promise<void> {
    this.value = value;
    await this.changeHandler?.(value);
  }
}

export class Setting {
  static instances: Setting[] = [];
  containerEl: HTMLElement;
  name = '';
  desc = '';
  dropdown?: DropdownComponent;
  text?: TextComponent;
  toggle?: ToggleComponent;
  button?: ButtonComponent;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    Setting.instances.push(this);
  }

  static reset(): void {
    Setting.instances = [];
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setHeading(): this {
    return this;
  }

  addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
    const dropdown = new DropdownComponent();
    this.dropdown = dropdown;
    callback(dropdown);
    return this;
  }

  addText(callback: (text: TextComponent) => unknown): this {
    const text = new TextComponent();
    this.text = text;
    callback(text);
    return this;
  }

  addToggle(callback: (toggle: ToggleComponent) => unknown): this {
    const toggle = new ToggleComponent();
    this.toggle = toggle;
    callback(toggle);
    return this;
  }

  addButton(callback: (button: ButtonComponent) => unknown): this {
    const button = new ButtonComponent(this.containerEl);
    this.button = button;
    callback(button);
    return this;
  }
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
  Setting,
  ItemView,
  Component,
  Modal,
  Notice,
  DropdownComponent,
  TextComponent,
  ToggleComponent,
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
