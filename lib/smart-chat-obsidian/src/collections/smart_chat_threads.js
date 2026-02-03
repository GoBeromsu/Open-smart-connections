import { Collection } from "smart-collections";
import { AjsonSingleFileCollectionDataAdapter } from "smart-collections/adapters/ajson_single_file.js";
import { SmartChatThread } from "../items/smart_chat_thread.js";
import { get_language_options, get_initial_message } from "../utils/self_referential_keywords.js";

/**
 * @class SmartChatThreads
 * @extends Collection
 * @description Manages chat threads. One is considered 'active' at a time.
 */
export class SmartChatThreads extends Collection {
  get chat_model() {
    const chat_model_opts = {
      model_config: {},
      settings: this.settings.chat_model,
      reload_model: () => console.log('no reload_model needed'),
      re_render_settings: this.open_settings?.bind(this),
    };
    return this.env.init_module('smart_chat_model', chat_model_opts);
  }

  async open_settings() {
    const plugin = this.env.smart_chat_plugin || this.env.smart_connections_plugin;
    await plugin.app.setting.open();
    await plugin.app.setting.openTabById('smart-chat');
  }

  /**
   * @property {string} settings.active_thread_key - The key of the currently active thread.
   * @returns {SmartChatThread|null}
   */
  get active_thread() {
    const key = this.settings.active_thread_key;
    if (!key) return null;
    const thread = this.get(key) || null;
    if (!thread || thread.deleted) {
      this.settings.active_thread_key = '';
      return null;
    }
    return thread;
  }
  set active_thread(thread) {
    if (!thread?.key) {
      this.settings.active_thread_key = '';
      return;
    }
    this.settings.active_thread_key = thread.key;
  }

  /**
   * Example default settings for chat threads collection:
   */
  static get default_settings() {
    return {
      active_thread_key: '',
      chat_model: {
        adapter: 'ollama',
      },
      system_prompt: '',
      detect_self_referential: true,
      review_context: true,
      stream: true,
      language: 'en',
      modifier_key_to_send: 'shift',
      use_tool_calls: true,
    };
  }

  get settings_config() {
    return {
      "language": {
        name: "Language",
        type: "dropdown",
        options_callback: 'get_language_options',
        description: "The language for the chat.",
        default: 'en'
      },
      "detect_self_referential": {
        name: "Detect Self-Referential Pronouns",
        type: "toggle",
        description: "Trigger lookup when user message references 'my notes', etc.",
      },
      "review_context": {
        name: "Review Context",
        type: "toggle",
        description: "Show retrieved context for approval before sending to AI.",
      },
      "system_prompt": {
        name: "System Prompt",
        type: "textarea",
        description: "Prepended to every thread as the system role message. Available variables: {{folder_tree}}, {{folders_top}}, {{tags}}, {{recent_N}}.",
      },
      "stream": {
        name: "Stream",
        type: "toggle",
        description: "Whether to stream the response from the AI.",
      },
      "modifier_key_to_send": {
        name: "Modifier key to send with Enter",
        type: "dropdown",
        "option-0": "none|Enter",
        "option-1": "shift|⇧ Shift + Enter",
        "option-2": "mod|⌘/Ctrl + Enter",
        "option-3": "alt|Alt + Enter",
        "option-4": "meta|⌘/⊞Win + Enter",
        default: "shift",
        description: "Choose which modifier (if any) is required with Enter to send the chat."
      },
      "use_tool_calls": {
        name: "Use tool calling for actions",
        type: "toggle",
        description: "Reccommended if the model you're using supports it. Turn off to use more-compatible yet less-reliable format.",
      }
    };
  }
  get_language_options() {
    return get_language_options();
  }
  async process_save_queue() {
    await super.process_save_queue();
    await this.env.smart_completions.process_save_queue();
    await this.env.smart_contexts.process_save_queue();
  }
}

export default {
  class: SmartChatThreads,
  collection_key: 'smart_chat_threads',
  data_adapter: AjsonSingleFileCollectionDataAdapter,
  item_type: SmartChatThread,
};
