import { ItemView, WorkspaceLeaf } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
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
    this.threadComponent?.unload();
    this.threadComponent = null;
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
    newChatBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    newChatBtn.addEventListener('click', () => this.createNewThread());

    // History button
    const historyBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Chat history' },
    });
    historyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 15"/></svg>';
    historyBtn.addEventListener('click', () => this.showHistory());

    // Settings button
    const settingsBtn = actions.createEl('button', {
      cls: 'osc-icon-btn',
      attr: { 'aria-label': 'Chat settings' },
    });
    settingsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/></svg>';
    settingsBtn.addEventListener('click', () => this.openSettings());

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
    // @ts-ignore - Obsidian internal API
    this.app.setting.open();
    // @ts-ignore
    this.app.setting.openTabById('open-smart-connections');
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    const wrapper = this.container.createDiv({ cls: 'osc-state osc-state--error' });
    wrapper.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
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
