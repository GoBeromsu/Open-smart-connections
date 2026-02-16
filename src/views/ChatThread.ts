import { Component, setIcon } from 'obsidian';
import type SmartConnectionsPlugin from '../app/main';
import { ChatMessage } from './ChatMessage';

/**
 * ChatThread - Renders a chat thread with all messages
 * Ported from lib/obsidian/chat/src/components/thread.js
 */
export class ChatThread extends Component {
  plugin: SmartConnectionsPlugin;
  containerEl: HTMLElement;
  thread: any = null;
  messageContainer: HTMLElement | null = null;
  inputEl: HTMLElement | null = null;
  sendButton: HTMLElement | null = null;
  typingIndicator: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, plugin: SmartConnectionsPlugin) {
    super();
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  onload(): void {
    // Component loaded
  }

  onunload(): void {
    // Clean up
    this.containerEl.empty();
  }

  /**
   * Render the thread
   */
  async render(thread: any): Promise<void> {
    this.thread = thread;
    this.containerEl.empty();

    // Build thread structure
    const threadEl = this.containerEl.createDiv({ cls: 'osc-chat-thread' });

    // Message container (scrollable)
    this.messageContainer = threadEl.createDiv({ cls: 'osc-chat-messages' });

    // Typing indicator
    this.typingIndicator = threadEl.createDiv({ cls: 'osc-chat-typing' });
    this.typingIndicator.style.display = 'none';
    const dotsContainer = this.typingIndicator.createDiv({ cls: 'osc-chat-typing-dots' });
    dotsContainer.createDiv({ cls: 'osc-chat-typing-dot' });
    dotsContainer.createDiv({ cls: 'osc-chat-typing-dot' });
    dotsContainer.createDiv({ cls: 'osc-chat-typing-dot' });

    // Input form
    this.buildInputForm(threadEl);

    // Render existing messages
    await this.renderMessages();

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Build the input form
   */
  buildInputForm(threadEl: HTMLElement): void {
    const form = threadEl.createDiv({ cls: 'osc-chat-form' });

    // System message area (optional)
    const systemContainer = form.createDiv({ cls: 'osc-chat-system-container' });
    systemContainer.style.display = 'none';

    const systemLabel = systemContainer.createEl('small', {
      text: 'System message',
      cls: 'osc-chat-system-label',
    });

    const systemInput = systemContainer.createEl('div', {
      cls: 'osc-chat-system-input',
      attr: { contenteditable: 'true', placeholder: 'Optional system message...' },
    });

    // Input row
    const inputRow = form.createDiv({ cls: 'osc-chat-input-row' });

    // Chat input
    this.inputEl = inputRow.createEl('div', {
      cls: 'osc-chat-input',
      attr: {
        contenteditable: 'true',
        'data-has-content': 'false',
        placeholder: 'Type a message... (use @ to add context)',
      },
    });

    // Button container
    const btnContainer = inputRow.createDiv({ cls: 'osc-chat-btn-container' });

    // Send button
    this.sendButton = btnContainer.createEl('button', {
      cls: 'osc-chat-send-btn',
      attr: { 'aria-label': 'Send message' },
    });
    setIcon(this.sendButton, 'send');
  }

  /**
   * Setup event listeners
   */
  setupEventListeners(): void {
    if (!this.inputEl || !this.sendButton) return;

    // Send button click
    this.registerDomEvent(this.sendButton, 'click', () => this.sendMessage());

    // Input keydown
    this.registerDomEvent(this.inputEl, 'keydown', (e) => {
      if (e.key === 'Enter') {
        // Shift+Enter = new line, Enter = send
        if (e.shiftKey) {
          // Allow default (new line)
        } else {
          e.preventDefault();
          this.sendMessage();
        }
      }
    });

    // Update has-content attribute
    this.registerDomEvent(this.inputEl, 'input', () => {
      const hasContent = this.inputEl?.textContent?.trim().length ?? 0 > 0;
      this.inputEl?.setAttribute('data-has-content', hasContent.toString());
    });

    // Paste handler (non-blocking)
    this.registerDomEvent(this.inputEl, 'paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        // Insert text at cursor
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
        }
      }
    });
  }

  /**
   * Send a message
   */
  async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.thread) return;

    const text = this.inputEl.textContent?.trim() ?? '';
    if (!text) return;

    // Clear input
    this.inputEl.textContent = '';
    this.inputEl.setAttribute('data-has-content', 'false');

    // Show typing indicator
    if (this.typingIndicator) {
      this.typingIndicator.style.display = 'flex';
    }

    try {
      // Create completion through the environment
      const env = this.plugin.env;
      if (!env?.smart_chat_threads) {
        throw new Error('Chat system not initialized');
      }

      // Add user message
      const completion = this.thread.current_completion || this.thread.init_completion();
      completion.data = {
        ...completion.data,
        user_message: text,
        new_user_message: true,
      };

      // Render the new message immediately
      await this.renderCompletion(completion);

      // Scroll to bottom
      this.scrollToBottom();

      // Process the completion (this will call the API and stream the response)
      await this.processCompletion(completion);

    } catch (error) {
      console.error('Failed to send message:', error);
      this.showError('Failed to send message: ' + (error as Error).message);
    } finally {
      // Hide typing indicator
      if (this.typingIndicator) {
        this.typingIndicator.style.display = 'none';
      }
    }
  }

  /**
   * Render all messages in the thread
   */
  async renderMessages(): Promise<void> {
    if (!this.messageContainer || !this.thread) return;

    this.messageContainer.empty();

    // Show initial message if no completions
    if (!this.thread.completions || this.thread.completions.length === 0) {
      const initialMsg = this.messageContainer.createDiv({ cls: 'osc-chat-initial' });
      initialMsg.createEl('p', {
        text: 'Start a conversation by typing a message below.',
        cls: 'osc-chat-initial-text',
      });
      return;
    }

    // Render each completion
    for (const completion of this.thread.completions) {
      await this.renderCompletion(completion);
    }

    this.scrollToBottom();
  }

  /**
   * Render a single completion (user message + assistant response)
   */
  async renderCompletion(completion: any): Promise<void> {
    if (!this.messageContainer) return;

    const completionEl = this.messageContainer.createDiv({ cls: 'osc-chat-completion' });

    // User message
    if (completion.data?.user_message) {
      const userMsg = new ChatMessage(completionEl, this.plugin);
      this.addChild(userMsg);
      await userMsg.render({
        role: 'user',
        content: completion.data.user_message,
      });
    }

    // Assistant message (if available)
    if (completion.response_text) {
      const assistantMsg = new ChatMessage(completionEl, this.plugin);
      this.addChild(assistantMsg);
      await assistantMsg.render({
        role: 'assistant',
        content: completion.response_text,
      });
    }
  }

  /**
   * Process a completion (call API and handle streaming)
   */
  async processCompletion(completion: any): Promise<void> {
    const env = this.plugin.env;
    if (!env?.smart_chat_threads) return;

    try {
      // Initialize the completion with streaming
      await completion.init({
        stream: env.smart_chat_threads.settings?.stream ?? true,
        stream_handlers: {
          chunk: async (c: any) => {
            // Update the assistant message as chunks arrive
            await this.updateAssistantMessage(c);
          },
          done: async (c: any) => {
            // Final update
            await this.updateAssistantMessage(c);
            // Save thread
            this.thread.queue_save?.();
          },
          error: (err: Error) => {
            console.error('Stream error:', err);
            this.showError('Stream error: ' + err.message);
          },
        },
      });
    } catch (error) {
      console.error('Failed to process completion:', error);
      this.showError('Failed to process: ' + (error as Error).message);
    }
  }

  /**
   * Update the assistant message during streaming
   */
  async updateAssistantMessage(completion: any): Promise<void> {
    if (!this.messageContainer || !completion.response_text) return;

    // Find or create assistant message element
    const lastCompletion = this.messageContainer.lastChild as HTMLElement;
    if (!lastCompletion) return;

    const assistantMsgEl = lastCompletion.querySelector('.osc-chat-message.assistant') as HTMLElement;

    if (!assistantMsgEl) {
      // Create new assistant message
      const assistantMsg = new ChatMessage(lastCompletion, this.plugin);
      this.addChild(assistantMsg);
      await assistantMsg.render({
        role: 'assistant',
        content: completion.response_text,
      });
    } else {
      // Update existing message
      const contentEl = assistantMsgEl.querySelector('.osc-chat-message-content') as HTMLElement;
      if (contentEl) {
        // Re-render with updated content
        const assistantMsg = new ChatMessage(assistantMsgEl.parentElement!, this.plugin);
        this.addChild(assistantMsg);
        await assistantMsg.update({
          role: 'assistant',
          content: completion.response_text,
        }, contentEl);
      }
    }

    this.scrollToBottom();
  }

  /**
   * Scroll to bottom of message container
   */
  scrollToBottom(): void {
    if (this.messageContainer) {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    if (!this.messageContainer) return;

    const errorEl = this.messageContainer.createDiv({ cls: 'osc-chat-error' });
    errorEl.createEl('p', { text: message, cls: 'osc-chat-error-text' });
  }
}
