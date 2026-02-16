import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SmartConnectionsPlugin from '../app/main';
import { ChatThread } from './ChatThread';
import { ChatHistoryModal } from './ChatHistoryModal';

export const CHAT_VIEW_TYPE = 'smart-chat-view';

/**
 * ChatView - Main chat interface
 * Contains input area, thread display, and model selector
 */
export class ChatView extends ItemView {
  plugin: SmartConnectionsPlugin;
  container: HTMLElement;
  threadComponent: ChatThread | null = null;
  currentThread: any = null;

  constructor(leaf: WorkspaceLeaf, plugin: SmartConnectionsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Smart Chat';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.container = this.containerEl.children[1] as HTMLElement;
    this.container.addClass('osc-chat-view');

    // Build the chat interface
    this.buildChatInterface();

    // Load or create initial thread
    await this.loadOrCreateThread();
  }

  async onClose(): Promise<void> {
    if (this.threadComponent) {
      this.removeChild(this.threadComponent);
      this.threadComponent = null;
    }
    this.container?.empty();
  }

  /**
   * Build the chat interface structure
   */
  buildChatInterface(): void {
    // Header with actions
    const header = this.container.createDiv({ cls: 'osc-chat-header' });

    const title = header.createDiv({ cls: 'osc-chat-title' });
    title.createSpan({ text: 'Smart Chat', cls: 'osc-chat-title-text' });

    const actions = header.createDiv({ cls: 'osc-chat-actions' });

    // New chat button
    const newChatBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'New chat' },
    });
    setIcon(newChatBtn, 'plus');
    this.registerDomEvent(newChatBtn, 'click', () => this.createNewThread());

    // History button
    const historyBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Chat history' },
    });
    setIcon(historyBtn, 'history');
    this.registerDomEvent(historyBtn, 'click', () => this.showHistory());

    // Settings button
    const settingsBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Chat settings' },
    });
    setIcon(settingsBtn, 'settings');
    this.registerDomEvent(settingsBtn, 'click', () => this.openSettings());

    // Thread container
    const threadContainer = this.container.createDiv({ cls: 'osc-chat-thread-container' });

    // Create thread component
    this.threadComponent = new ChatThread(threadContainer, this.plugin);
    this.addChild(this.threadComponent);
  }

  /**
   * Load existing thread or create new one
   */
  async loadOrCreateThread(): Promise<void> {
    const env = this.plugin.env;
    if (!env?.smart_chat_threads) {
      this.showError('Chat system not initialized');
      return;
    }

    // Get or create current thread
    this.currentThread = env.smart_chat_threads.current_thread;
    if (!this.currentThread) {
      this.currentThread = env.smart_chat_threads.create_thread();
    }

    // Render thread
    if (this.threadComponent) {
      await this.threadComponent.render(this.currentThread);
    }
  }

  /**
   * Create a new chat thread
   */
  async createNewThread(): Promise<void> {
    const env = this.plugin.env;
    if (!env?.smart_chat_threads) return;

    this.currentThread = env.smart_chat_threads.create_thread();

    if (this.threadComponent) {
      await this.threadComponent.render(this.currentThread);
    }
  }

  /**
   * Show chat history modal
   */
  showHistory(): void {
    new ChatHistoryModal(this.app, this.plugin, (thread) => {
      this.loadThread(thread);
    }).open();
  }

  /**
   * Load a specific thread
   */
  async loadThread(thread: any): Promise<void> {
    this.currentThread = thread;

    if (this.threadComponent) {
      await this.threadComponent.render(thread);
    }
  }

  /**
   * Open chat settings
   */
  openSettings(): void {
    // @ts-expect-error - Obsidian internal API
    this.app.setting.open();
    // @ts-expect-error - Obsidian internal API
    this.app.setting.openTabById('open-smart-connections');
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
    setIcon(iconEl, 'alert-circle');
    wrapper.createEl('p', { text: message, cls: 'osc-state-text' });
  }

  /**
   * Open or reveal the chat view
   */
  static open(workspace: any): void {
    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length) {
      workspace.revealLeaf(existing[0]);
    } else {
      workspace.getRightLeaf(false)?.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
    }
  }

  /**
   * Get the active chat view
   */
  static getView(workspace: any): ChatView | null {
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    return leaves.length ? leaves[0].view as ChatView : null;
  }
}
