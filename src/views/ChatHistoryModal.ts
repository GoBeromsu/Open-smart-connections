import { Modal, App, setIcon, ButtonComponent } from 'obsidian';
import type SmartConnectionsPlugin from '../app/main';

/**
 * ChatHistoryModal - Shows all chat threads
 * Click to load a thread, Shift+Click to delete
 */
export class ChatHistoryModal extends Modal {
  plugin: SmartConnectionsPlugin;
  onSelect: (thread: any) => void;

  constructor(app: App, plugin: SmartConnectionsPlugin, onSelect: (thread: any) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.addClass('osc-chat-history-modal');

    // Title
    const title = contentEl.createEl('h2', {
      text: 'Chat History',
      cls: 'osc-modal-title',
    });

    // Get threads from environment
    const env = this.plugin.env;
    if (!env?.smart_chat_threads) {
      this.showError('Chat system not initialized');
      return;
    }

    const threads = this.getThreads();

    if (threads.length === 0) {
      this.showEmpty();
      return;
    }

    // Thread list
    const list = contentEl.createDiv({ cls: 'osc-chat-history-list' });

    for (const thread of threads) {
      this.renderThread(list, thread);
    }

    // Footer hint
    const footer = contentEl.createDiv({ cls: 'osc-modal-footer' });
    footer.createEl('small', {
      text: 'Click to load • Shift+Click to delete',
      cls: 'osc-modal-hint',
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Get all threads
   */
  getThreads(): any[] {
    const env = this.plugin.env;
    if (!env?.smart_chat_threads) return [];

    try {
      // Get threads from collection
      const threads = env.smart_chat_threads.threads || [];

      // Sort by updated_at (most recent first)
      return threads.sort((a: any, b: any) => {
        const aTime = a.data?.updated_at || 0;
        const bTime = b.data?.updated_at || 0;
        return bTime - aTime;
      });
    } catch (error) {
      console.error('Failed to get threads:', error);
      return [];
    }
  }

  /**
   * Render a thread item
   */
  renderThread(container: HTMLElement, thread: any): void {
    const item = container.createDiv({ cls: 'osc-history-item' });

    // Thread info
    const info = item.createDiv({ cls: 'osc-history-info' });

    // Title (first user message or "New Chat")
    const title = this.getThreadTitle(thread);
    info.createDiv({ text: title, cls: 'osc-history-title' });

    // Metadata
    const meta = info.createDiv({ cls: 'osc-history-meta' });

    // Message count
    const messageCount = thread.completions?.length || 0;
    meta.createSpan({
      text: `${messageCount} message${messageCount !== 1 ? 's' : ''}`,
      cls: 'osc-history-count',
    });

    // Last updated
    const lastUpdated = this.formatDate(thread.data?.updated_at || Date.now());
    meta.createSpan({
      text: lastUpdated,
      cls: 'osc-history-date',
    });

    // Click handlers
    item.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Shift+Click = delete
        this.confirmDelete(thread);
      } else {
        // Click = load
        this.onSelect(thread);
        this.close();
      }
    });

  }

  /**
   * Get thread title
   */
  getThreadTitle(thread: any): string {
    // Try to get first user message
    if (thread.completions && thread.completions.length > 0) {
      const firstCompletion = thread.completions[0];
      const userMessage = firstCompletion.data?.user_message;

      if (userMessage) {
        // Truncate to first line and max 60 chars
        const firstLine = userMessage.split('\n')[0];
        return firstLine.length > 60
          ? firstLine.substring(0, 57) + '...'
          : firstLine;
      }
    }

    // Fallback to thread name or "New Chat"
    return thread.data?.name || 'New Chat';
  }

  /**
   * Format date
   */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return minutes <= 1 ? 'Just now' : `${minutes}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Format as date
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }

  /**
   * Confirm thread deletion
   */
  confirmDelete(thread: any): void {
    const confirmModal = new Modal(this.app);
    confirmModal.contentEl.addClass('osc-confirm-modal');

    confirmModal.contentEl.createEl('h3', {
      text: 'Delete chat?',
      cls: 'osc-modal-title',
    });

    confirmModal.contentEl.createEl('p', {
      text: 'This action cannot be undone.',
      cls: 'osc-modal-text',
    });

    const buttons = confirmModal.contentEl.createDiv({ cls: 'osc-modal-buttons' });

    new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => confirmModal.close());
    new ButtonComponent(buttons).setButtonText('Delete').setWarning().onClick(async () => {
      await this.deleteThread(thread);
      confirmModal.close();
      this.onOpen();
    });

    confirmModal.open();
  }

  /**
   * Delete a thread
   */
  async deleteThread(thread: any): Promise<void> {
    try {
      const env = this.plugin.env;
      if (!env?.smart_chat_threads) return;

      // Delete thread
      await thread.delete?.();

      // Or remove from collection
      env.smart_chat_threads.delete?.(thread.key);
    } catch (error) {
      console.error('Failed to delete thread:', error);
    }
  }

  /**
   * Show empty state
   */
  showEmpty(): void {
    const wrapper = this.contentEl.createDiv({ cls: 'osc-modal-empty' });
    const iconEl = wrapper.createDiv({ cls: 'osc-state-icon' });
    setIcon(iconEl, 'message-square');
    wrapper.createEl('p', {
      text: 'No chat history yet',
      cls: 'osc-modal-empty-text',
    });
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    const wrapper = this.contentEl.createDiv({ cls: 'osc-modal-error' });
    wrapper.createEl('p', { text: message });
  }
}
