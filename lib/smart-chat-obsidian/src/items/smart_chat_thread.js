import { CollectionItem } from 'smart-collections';
import { add_thread_item, list_thread_items } from '../utils/add_thread_item.js';
import { contains_self_referential_keywords } from '../utils/self_referential_keywords.js';
import { replace_folder_tree_var } from 'smart-context-obsidian/src/utils/replace_folder_tree_var.js';

/**
 * @class SmartChatThread
 * @extends CollectionItem
 * @description Represents a single chat thread with multiple completions.
 */
export class SmartChatThread extends CollectionItem {
  static get defaults() {
    return {
      data: {
        name: '',
        system_prompt: '',
        items: {}
      }
    };
  }

  get_key() {
    if (!this.data.key) {
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const formatted = `Untitled Chat ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      this.data.key = formatted;
    }
    return this.data.key;
  }

  /**
   * @property {string} name - Friendly thread name; falls back to key if empty.
   */
  get name() {
    return this.data.name || this.data.key;
  }
  set name(val) {
    this.data.name = val;
  }

  get chat_model() {
    return this.collection.chat_model;
  }

  init_completion(data={}) {
    const completion_data = {
      key: `${this.key}-${Date.now()}`,
      thread_key: this.key,
      stream: this.collection.settings.stream,
      ...data
    };
    if (this.has_default_system_prompt && !this.completions[0]?.data?.system_message) {
      completion_data.system_message = this.get_system_prompt(completion_data);
    }
    if(!completion_data.context_key) {
      // If no context_key is provided, use the last completion's context_key if available
      const last_context_key = this.last_completion?.data?.context_key;
      completion_data.context_key = last_context_key || this.env.smart_contexts.new_context().key;
    }
    const completion = new this.env.smart_completions.item_type(this.env, completion_data);
    this.env.smart_completions.set(completion);
    completion.chat_model = this.chat_model;
    this._current_completion = completion;
    add_thread_item(this, completion.key);
    return completion;
  }

  /**
   * Updates the context for the current completion.
   * @param {object|null} context
   */
  update_current_context(context, opts = {}) {
    this.current_completion.data.context_key = context?.key || null;
  }

  get current_completion() {
    const most_recent_completion = this.completions.at(-1);
    if (most_recent_completion && most_recent_completion.data.completion.responses.length === 0) {
      this._current_completion = most_recent_completion;
    }
    if (!this._current_completion || (this._current_completion && this._current_completion.data.completion.responses.length !== 0)) {
      this._current_completion = this.init_completion(); // prevent current_completion from being null and causing downstream errors
    }
    return this._current_completion;
  }
  set current_completion(completion) {
    this._current_completion = completion;
  }

  get last_completion() {
    return this.completions.findLast(completion => completion.response);
  }

  get completion_keys() {
    return list_thread_items(this);
  }
  get completions() {
    return this.completion_keys.map(key => this.env.smart_completions.get(key)).filter(Boolean);
  }

  get has_default_system_prompt() {
    return this.settings.system_prompt.trim().length > 0;
  }

  /**
   * Build system-prompt text, expanding {{folder_tree}} if present.
   * @param {object} [opts={}]  optional { system_message }
   * @returns {string}
   */
  get_system_prompt(opts = {}) {
    let prompt = this.settings.system_prompt || '';
    if (opts.system_message) {
      prompt = prompt
        ? `${prompt}\n\n${opts.system_message}`
        : opts.system_message;
    }

    // If the prompt contains {{folder_tree}}, replace it with the folder tree string.
    if (prompt.includes('{{folder_tree}}')) {
      prompt = replace_folder_tree_var(prompt);
    }

    return prompt;
  }


  get messages() {
    return this.completions.map(completion => completion.messages).flat();
  }

  /**
   * Checks if the user_message contains self-referential pronouns
   * (only if user enabled the detection in settings).
   * @param {string} user_message 
   * @returns {boolean} 
   */
  has_self_referential_pronoun(user_message) {
    if (!user_message) return false;
    if (!this.collection.settings.detect_self_referential) return false;
    const lang = this.collection.settings.language || 'en';
    return contains_self_referential_keywords(user_message, lang);
  }
}