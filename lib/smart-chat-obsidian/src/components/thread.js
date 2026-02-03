import thread_css from './thread.css' with { type: 'css' };
import { get_initial_message } from '../utils/self_referential_keywords.js';
import { Keymap } from 'obsidian';
import { insert_text_in_chunks } from '../utils/insert_text_in_chunks.js';
import { ContextSelectorModal } from 'smart-context-obsidian/src/views/context_selector_modal.js';
// import { insert_text_in_chunks } from '../utils/chunk_insert.js';
import { add_items_to_current_context } from '../utils/add_items_to_current_context.js';
import { parse_dropped_data } from '../utils/parse_dropped_data.js';
import { Menu } from 'obsidian';
import { insert_variable_at_cursor, create_variable_menu } from './variable_utils.js';

import { send_context_changed_event } from 'smart-context-obsidian/src/utils/send_context_changed_event.js';
/**
 * Determines if the user has pressed Enter + the required modifier.
 * @param {KeyboardEvent} e
 * @param {string} requiredModifier - 'none' | 'shift' | 'mod' | 'alt' | 'meta'
 * @returns {boolean}
 */
export function should_send_message(e, requiredModifier) {
  const pressed_shift = Keymap.isModifier(e, 'Shift');
  const pressed_mod = Keymap.isModifier(e, 'Mod');
  const pressed_alt = Keymap.isModifier(e, 'Alt');
  const pressed_meta = Keymap.isModifier(e, 'Meta');

  if (requiredModifier === 'none') {
    return !pressed_shift && !pressed_mod && !pressed_alt && !pressed_meta;
  }
  if (requiredModifier === 'shift') return pressed_shift;
  if (requiredModifier === 'mod') return pressed_mod;
  if (requiredModifier === 'alt') return pressed_alt;
  if (requiredModifier === 'meta') return pressed_meta;
  return false;
}


/**
 * build_html
 */
export function build_html(chat_thread, opts = {}) {
  return `<div>
    <div class="smart-chat-thread" data-thread-key="${chat_thread.key}">
      <div class="smart-chat-message-container"></div>
      <div class="smart-chat-typing-indicator">
        <div class="smart-chat-typing-dots">
          <div class="smart-chat-typing-dot"></div>
          <div class="smart-chat-typing-dot"></div>
          <div class="smart-chat-typing-dot"></div>
        </div>
      </div>
      <div class="smart-chat-action-bar">
      </div>
      <div class="smart-chat-chat-form">
        <div class="smart-chat-system-message-container">
          <small class="smart-chat-system-message-label">Edit system message</small>
          <div
            class="smart-chat-system-message"
            contenteditable="true"
            placeholder="Edit system message"
          ></div>
          <button class="smart-chat-add-variable" title="Add variable" type="button">+</button>
        </div>
        <div class="smart-chat-chat-input-row">
          <div
            contenteditable="true"
            class="smart-chat-chat-input"
            data-has-content="false"
            placeholder="Use @ to add context. eg Based on my notes"
          ></div>
          <div class="smart-chat-btn-container">
            <button class="send-button" id="smart-chat-send-button">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 2 11 13 3 9l19-7z"></path>
                <path d="M22 2 15 22l-4-9-8-4z"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * render
 */
export async function render(chat_thread, opts = {}) {
  if(!chat_thread.container) {
    const html = build_html.call(this, chat_thread, opts);
    const frag = this.create_doc_fragment(html);
    this.apply_style_sheet(thread_css);
    chat_thread.container = frag.querySelector('.smart-chat-thread');
  }
  post_process.call(this, chat_thread, chat_thread.container, opts);
  return chat_thread.container;
}

/**
 * @function post_process
 * @description Attach event handlers, handle completions rendering, etc.
 * @param {Object} chat_thread
 * @param {DocumentFragment} thread_container
 * @param {Object} opts
 * @returns {DocumentFragment}
 */
export async function post_process(chat_thread, thread_container, opts = {}) {
  const env = chat_thread.env;
  const plugin = env.smart_chat_plugin || env.smart_connections_plugin;

  // The container where message elements are appended
  const message_container = chat_thread.container.querySelector('.smart-chat-message-container');
  chat_thread.message_container = message_container;

  // Render existing completions, or show an initial placeholder message
  if (chat_thread.completions?.length > 0) {
    for (const completion_item of chat_thread.completions) {
      const completion_frag = await completion_item.env.render_component('completion', completion_item, {});
      message_container.appendChild(completion_frag);
    }
  } else {
    const initial_message = get_initial_message(chat_thread.settings.language);
    this.safe_inner_html(message_container, `
      <div class="smart-chat-default-message">${initial_message}</div>
    `);
    // redundant since init_completion called in current_completion getter
    // if(!chat_thread.current_completion) {
    //   chat_thread.current_completion = chat_thread.init_completion();
    // }
    if(!chat_thread.current_completion.container) {
      const completion_container = await env.render_component('completion', chat_thread.current_completion);
      message_container.appendChild(completion_container);
    }

  }

  // DOM references for user interaction
  const send_button = chat_thread.container.querySelector('#smart-chat-send-button');
  const input_el = chat_thread.container.querySelector('.smart-chat-chat-input');
  const system_editor = chat_thread.container.querySelector('.smart-chat-system-message');
  const system_label = chat_thread.container.querySelector('.smart-chat-system-message-label');
  const variable_btn = chat_thread.container.querySelector('.smart-chat-add-variable');

  // Toggle system prompt editor on label click
  if (system_label && system_editor) {
    system_label.addEventListener('click', () => {
      system_editor.style.display = 'block';
      system_label.style.display = 'none';
    });
  }

  if (variable_btn) {
    variable_btn.addEventListener('click', (e) => {
      e.preventDefault();
      const vars =
        env.config.collections.smart_completions.completion_adapters.SmartCompletionVariableAdapter.available_vars;
      const menu = create_variable_menu(Menu, plugin.app, vars, (v) => {
        insert_variable_at_cursor(input_el, v);
      });
      menu.showAtMouseEvent(e);
    });
  }

  const do_send = () => {
    const user_text = input_el.textContent.trim();
    if (!user_text) return;

    const sys_msg = system_editor.textContent.trim();
    const data = { user_message: user_text, new_user_message: true };
    if (sys_msg) data.system_message = chat_thread.get_system_prompt({ system_message: sys_msg });
    // If user has chosen to detect self-referential pronouns, do so now:
    if (chat_thread.has_self_referential_pronoun(user_text)) {
      /**
       * Prevent redundant look‑ups:
       * ‑ If the current completion already points at a context containing
       *   at least one item (i.e. the user dragged material in manually),
       *   **do not** enqueue a lookup_context action.
       */
      const ctx_key              = chat_thread.current_completion.data.context_key;
      const existing_ctx         = env.smart_contexts.get(ctx_key);
      const has_manual_context   = existing_ctx
        && Object.keys(existing_ctx.data?.context_items ?? {}).length > 0;

      if (!has_manual_context) {
        // Automatically trigger lookup_context
        const action_property   = chat_thread.collection.settings.use_tool_calls
          ? 'action_key'
          : 'action_xml_key';
        data[action_property]   = 'lookup_context';
        data.action_opts        = { context_key: ctx_key };
      }
    }

    chat_thread.current_completion.data = { ...chat_thread.current_completion.data, ...data };
    env.render_component('completion', chat_thread.current_completion);

    this.safe_inner_html(input_el, '<br>');
    input_el.dataset.hasContent = false;
    system_editor.textContent = '';
    system_editor.style.display = 'none';
    system_label.style.display = 'inline';
  };

  send_button.addEventListener('click', e => {
    e.preventDefault();
    do_send();
  });


  input_el.addEventListener('keydown', e => {

    if (e.key === '@') {
      e.preventDefault();

      ContextSelectorModal.open(
        env,
        {
          ctx: chat_thread.current_completion
            ? env.smart_contexts.get(
                chat_thread.current_completion.data.context_key
              )
            : null,
            opener_container: () => chat_thread.current_completion?.context_elm,
        }
      );

      return;
    }

    if (e.key !== 'Enter') return;

    const mod_key_setting = chat_thread.settings.modifier_key_to_send || 'shift';
    if (should_send_message(e, mod_key_setting)) {
      e.preventDefault();
      do_send();
    } else {
      e.preventDefault();
      document.execCommand('insertHTML', false, '<br><br>');
    }
  });

  input_el.addEventListener('keyup', () => {
    input_el.dataset.hasContent = input_el.textContent.trim().length > 0;
  });
  /**
   * non-blocking paste handler
   */
  // Use a named handler and attach it only once to prevent multiple listeners
  function handle_paste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      const target = e.currentTarget;
      insert_text_in_chunks(target, text, { chunk_size: 2048 });
      target.dataset.hasContent = true;
    }
  }
  if (!input_el._scPasteHandler) {
    input_el._scPasteHandler = handle_paste;
    input_el.addEventListener('paste', input_el._scPasteHandler);
  }

  // Drag-and-Drop: adding dropped files or text to the current context
  const sc_thread_el = chat_thread.container;
  if (sc_thread_el) {
    sc_thread_el.addEventListener('dragover', ev => ev.preventDefault());

    sc_thread_el.addEventListener('drop', async ev => {
      ev.preventDefault();

      /* 1. normalise all payloads */
      const paths = [...parse_dropped_data(ev.dataTransfer)];

      if (!paths.length) return;

      /* 2. single, idempotent context update */
      const updated_ctx = await add_items_to_current_context(chat_thread, paths);


      const target_elm = chat_thread.current_completion?.context_elm;
      if(target_elm) {
        send_context_changed_event(target_elm, updated_ctx);
      } else {
        console.warn('[smart-chat-obsidian] No current completion context element found for context update');
      }
    });
  }

  // If SHIFT+Enter was used in ChatHistoryModal => confirm_deletion
  if (chat_thread.confirm_deletion) {
    const overlay_frag = await env.render_component('confirm_delete', chat_thread, opts);
    chat_thread.container.appendChild(overlay_frag);
  }

  // Check for missing config (like missing model or API key)
  const chat_model_config = env.smart_chat_threads?.settings?.chat_model;
  const platform_key = chat_model_config?.adapter;
  const model_config = chat_model_config?.[platform_key];
  const missing_api_key = (!model_config?.api_key || model_config.api_key.length === 0) && !['ollama','lm_studio'].includes(platform_key);

  if (!platform_key || missing_api_key) {
    const missing_opts = {
      message: missing_api_key
        ? `No API key detected for ${platform_key}. Please update your Smart Chat settings.`
        : "No chat model selected. Please pick a model in the Smart Chat settings."
    };
    const overlay_frag = await env.render_component('overlay_requires_settings', chat_thread, missing_opts);
    chat_thread.container.appendChild(overlay_frag);
  }

  return thread_container;
}
