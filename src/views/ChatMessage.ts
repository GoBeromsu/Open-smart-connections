import { Component, MarkdownRenderer, setIcon } from 'obsidian';
import type SmartConnectionsPlugin from '../app/main';

export interface MessageData {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: any[];
}

/**
 * ChatMessage - Renders an individual chat message
 * Uses MarkdownRenderer for content, supports streaming updates
 */
export class ChatMessage extends Component {
  plugin: SmartConnectionsPlugin;
  containerEl: HTMLElement;
  messageEl: HTMLElement | null = null;
  contentEl: HTMLElement | null = null;
  data: MessageData | null = null;

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
    this.messageEl?.remove();
  }

  /**
   * Render the message
   */
  async render(data: MessageData): Promise<void> {
    this.data = data;

    // Create message element
    this.messageEl = this.containerEl.createDiv({
      cls: `osc-chat-message ${data.role}`,
    });

    // Message content
    this.contentEl = this.messageEl.createDiv({ cls: 'osc-chat-message-content' });

    // Render content based on role
    await this.renderContent();

    // Add actions for assistant messages
    if (data.role === 'assistant') {
      this.addActions();
    }

    // Render tool calls if present
    if (data.tool_calls && data.tool_calls.length > 0) {
      await this.renderToolCalls();
    }
  }

  /**
   * Update the message content (for streaming)
   */
  async update(data: MessageData, existingContentEl?: HTMLElement): Promise<void> {
    this.data = data;

    if (existingContentEl) {
      this.contentEl = existingContentEl;
    }

    if (!this.contentEl) return;

    // Re-render content
    this.contentEl.empty();
    await this.renderMarkdown(data.content, this.contentEl);
  }

  /**
   * Render message content
   */
  async renderContent(): Promise<void> {
    if (!this.data || !this.contentEl) return;

    const { role, content } = this.data;

    if (role === 'system') {
      // System messages are plain text with a label
      const label = this.contentEl.createEl('strong', { text: 'System: ' });
      label.style.fontSize = 'var(--font-ui-smaller)';
      label.style.color = 'var(--text-faint)';
      this.contentEl.createSpan({ text: content });
    } else {
      // User and assistant messages use MarkdownRenderer
      await this.renderMarkdown(content, this.contentEl);
    }
  }

  /**
   * Render markdown content
   */
  async renderMarkdown(content: string, targetEl: HTMLElement): Promise<void> {
    try {
      await MarkdownRenderer.render(
        this.plugin.app,
        content,
        targetEl,
        '',
        this,
      );

      // Make links clickable
      this.makeLinksClickable(targetEl);
    } catch (error) {
      console.error('Failed to render markdown:', error);
      targetEl.setText(content);
    }
  }

  /**
   * Make rendered links clickable
   */
  makeLinksClickable(container: HTMLElement): void {
    container.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;

      this.registerDomEvent(a as HTMLElement, 'click', (e) => {
        e.preventDefault();

        // External URLs
        if (/^https?:/i.test(href)) {
          window.open(href, '_blank');
          return;
        }

        // Obsidian deep links
        if (/^obsidian:/i.test(href)) {
          this.plugin.app.workspace.openLinkText(href, '/');
          return;
        }

        // Internal note links
        this.openNote(href, e);
      });

      // Hover preview for internal links
      if (!href.includes('://')) {
        this.registerDomEvent(a as HTMLElement, 'mouseover', (e) => {
          let filePath = href;
          if (!filePath.endsWith('.md')) filePath += '.md';

          const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filePath, '');
          if (!file) return;

          this.plugin.app.workspace.trigger('hover-link', {
            event: e,
            source: 'smart-chat-view',
            hoverParent: a.parentElement,
            targetEl: a,
            linktext: file.path,
          });
        });

        // Drag support for internal links
        this.registerDomEvent(a as HTMLElement, 'dragstart', (e) => {
          let filePath = href;
          if (!filePath.endsWith('.md')) filePath += '.md';

          const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filePath, '');
          if (!file) return;

          const dragManager = (this.plugin.app as any).dragManager;
          if (!dragManager) return;
          const dragData = dragManager.dragFile(e, file);
          dragManager.onDragStart(e, dragData);
        });
      }
    });
  }

  /**
   * Open a note
   */
  openNote(path: string, event: MouseEvent): void {
    this.plugin.open_note(path, event);
  }

  /**
   * Add action buttons for assistant messages
   */
  addActions(): void {
    if (!this.messageEl || !this.data) return;

    const actions = this.messageEl.createDiv({ cls: 'osc-chat-message-actions' });

    // Copy button
    const copyBtn = actions.createEl('button', {
      cls: 'osc-chat-action-btn',
      attr: { 'aria-label': 'Copy to clipboard' },
    });
    setIcon(copyBtn, 'copy');

    this.registerDomEvent(copyBtn, 'click', async () => {
      if (!this.data?.content) return;

      try {
        await navigator.clipboard.writeText(this.data.content);
        copyBtn.addClass('osc-chat-action-btn--success');
        setTimeout(() => {
          copyBtn.removeClass('osc-chat-action-btn--success');
        }, 1000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    });
  }

  /**
   * Render tool calls
   */
  async renderToolCalls(): Promise<void> {
    if (!this.data?.tool_calls || !this.messageEl) return;

    const toolCallsEl = this.messageEl.createDiv({ cls: 'osc-chat-tool-calls' });
    toolCallsEl.createEl('div', {
      text: 'Tool Calls:',
      cls: 'osc-chat-tool-calls-label',
    });

    for (const toolCall of this.data.tool_calls) {
      const callEl = toolCallsEl.createDiv({ cls: 'osc-chat-tool-call' });

      // Tool name
      callEl.createEl('strong', {
        text: toolCall.function?.name || 'Unknown',
        cls: 'osc-chat-tool-name',
      });

      // Tool arguments (formatted)
      if (toolCall.function?.arguments) {
        try {
          const args = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

          const argsEl = callEl.createEl('pre', { cls: 'osc-chat-tool-args' });
          argsEl.createEl('code', {
            text: JSON.stringify(args, null, 2),
          });
        } catch (error) {
          console.error('Failed to parse tool call arguments:', error);
        }
      }
    }
  }
}
