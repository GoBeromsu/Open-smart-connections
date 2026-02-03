import { FuzzySuggestModal } from 'obsidian';
import { SmartChatView } from './smart_chat.obsidian.js';

/**
 * @class ChatHistoryModal
 * @extends FuzzySuggestModal
 * @description Lists existing chat threads so the user can pick one
 * to re-open. SHIFT+Enter sets confirm_deletion on the chosen thread,
 * triggering a delete confirmation overlay when the thread is opened.
 */
export class ChatHistoryModal extends FuzzySuggestModal {
  /**
   * @param {Object} plugin - Main plugin instance with `app` and `env`.
   */
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.env = this.plugin.env;
    this.shift_enter = false;

    this.setPlaceholder('Search existing chat threads...');

    // Provide instructions in the modal (visible at the bottom).
    this.setInstructions([
      { command: 'Enter', purpose: 'Open the selected thread' },
      { command: 'Shift+Enter', purpose: 'Delete the selected thread' }
    ]);

    // Add SHIFT+Enter detection
    this.inputEl.addEventListener('keydown', (e) => {
      // SHIFT + Enter => open thread with confirm_deletion = true
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        this.shift_enter = true;
        // Use base-class method to pick the active suggestion
        this.selectActiveSuggestion(e);
      }
    });
  }

  /**
   * Returns a list of thread items from `smart_chat_threads`.
   * @returns {Array<Object>}
   */
  getItems() {
    const threads = Object.values(this.env.smart_chat_threads.items);
    return threads.filter(t =>
      !t.deleted && (
        t.completions.length > 1 ||
        (t.completions.length === 1 && t.completions[0].response) ||
        (t.name && t.name !== t.key)
      )
    );
  }

  /**
   * Called to get the display text for each thread in the suggestions list.
   * @param {Object} thread
   * @returns {string}
   */
  getItemText(thread) {
    return thread.name;
  }

  /**
   * Invoked when the user picks a suggestion.
   * If SHIFT+Enter was pressed, sets thread.confirm_deletion = true.
   * Then sets the chosen thread active and re-renders the chat UI.
   * @param {Object} thread
   */
  onChooseItem(thread) {
    if (this.shift_enter) {
      thread.confirm_deletion = true;
    }
    this.env.smart_chat_threads.active_thread = thread;
    SmartChatView.open(this.plugin);
  }
}