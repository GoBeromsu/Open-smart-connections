import chat_css from './chat.css' with { type: 'css' };
import { ChatHistoryModal } from '../chat_history_modal.js';
import { StoryModal } from 'obsidian-smart-env/modals/story.js';

/**
 * @function build_html
 * @description Builds raw HTML (often a pure function).
 * @param {Object} chat_threads_collection
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(chat_threads_collection, opts = {}) {
  return `<div>
    <div class="smart-chat-chat-container">
      <div class="smart-chat-top-bar-container">
        <input
          class="smart-chat-chat-name-input"
          type="text"
          value=""
          placeholder="Add name to save this chat"
        />
        <button title="New Chat" id="smart-chat-new-chat-button">
          ${this.get_icon_html('plus')}
        </button>
        <button title="Chat History" id="smart-chat-chat-history-button">
          ${this.get_icon_html('history')}
        </button>
        <button title="Chat Settings" id="smart-chat-chat-settings-button">
          ${this.get_icon_html('settings')}
        </button>
        <button title="Chat Help" id="smart-chat-help-button">
          ${this.get_icon_html('help-circle')}
        </button>
      </div>
      <div class="smart-chat-threads-container"></div>
      <div class="smart-chat-brand">
        ${this.get_icon_html('smart-chat')}
        <p>
          <a style="font-weight: 700;" href="https://smartconnections.app/">
            Smart Chat
          </a>
        </p>
      </div>
    </div>
  </div>`;
}

/**
 * @function render
 * @description Builds and renders the component, then calls post_process.
 * @param {Object} chat_threads_collection
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(chat_threads_collection, opts = {}) {
  const html = await build_html.call(this, chat_threads_collection, opts);
  const frag = this.create_doc_fragment(html);
  chat_threads_collection.container = frag.querySelector('.smart-chat-chat-container');
  this.apply_style_sheet(chat_css);
  post_process.call(this, chat_threads_collection, chat_threads_collection.container, opts);
  return chat_threads_collection.container;
}

/**
 * @function post_process
 * @description Attaches event listeners and calls thread.js for the active thread.
 * Also implements naming the chat thread by updating data.key.
 * @param {Object} chat_threads_collection
 * @param {DocumentFragment} container
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function post_process(chat_threads_collection, container, opts = {}) {
  const env = chat_threads_collection.env;
  const threads_container = chat_threads_collection.container.querySelector('.smart-chat-threads-container');
  let active_thread = chat_threads_collection.active_thread;
  const plugin = env.smart_chat_plugin || env.smart_connections_plugin;

  // If no active thread, only create a new thread if no threads exist
  if (!active_thread) {
    const all_threads = Object.values(chat_threads_collection.items).filter(
      thread => !thread.deleted
    );
    if (all_threads.length === 0) {
      // Only create a new thread if truly none exist
      console.log('No threads exist, creating a new thread...');
      active_thread = await chat_threads_collection.create_or_update();
      chat_threads_collection.active_thread = active_thread;
    } else {
      active_thread = all_threads[0];
      chat_threads_collection.active_thread = active_thread;
    }
  }

  // Render the active thread
  if (threads_container && active_thread) {
    this.empty(threads_container);
    const thread_frag = await env.render_component('thread', active_thread, opts);
    threads_container.appendChild(thread_frag);
  }

   // 1) Implement naming the chat thread + default timestamp
  const thread_name_input = container.querySelector('.smart-chat-chat-name-input');
  if (thread_name_input) {
    thread_name_input.value = active_thread.name;
    
    // On blur or Enter -> rename the thread
    const renameHandler = (current_thread) => {
      const new_val = thread_name_input.value.trim();
      if (!new_val || new_val === current_thread.name) {
        return;
      }
      rename_thread(chat_threads_collection, current_thread, new_val);
      // Add animation to confirm rename
      thread_name_input.classList.add('smart-chat-name-saved');
      // Remove animation class after animation completes
      setTimeout(() => {
        thread_name_input.classList.remove('smart-chat-name-saved');
      }, 1000);
    };

    // Helper function to get current thread from event
    const get_current_thread_from_event = (e) => {
      const chat_container = e.target.closest('.smart-chat-chat-container');
      const thread_key = chat_container.querySelector('[data-thread-key]').dataset.threadKey;
      return chat_threads_collection.get(thread_key);
    };
    
    // Handle blur event
    thread_name_input.addEventListener('blur', (e) => {
      const current_thread = get_current_thread_from_event(e);
      renameHandler(current_thread);
    });
    
    // Handle Enter key press
    thread_name_input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const current_thread = get_current_thread_from_event(e);
        renameHandler(current_thread);
        // Remove focus to trigger blur
        thread_name_input.blur();
      }
    });
  }

  // 2) Handle "New Chat" button
  const new_chat_button = chat_threads_collection.container.querySelector('#smart-chat-new-chat-button');
  if (new_chat_button) {
    new_chat_button.addEventListener('click', async (e) => {
      e.preventDefault();

      const new_thread = await chat_threads_collection.create_or_update();

      chat_threads_collection.active_thread = new_thread;
      if (threads_container) {
        this.empty(threads_container);
      }
      const thread_frag = await env.render_component('thread', new_thread, opts);
      threads_container.appendChild(thread_frag);

      // Also set the top bar's name input
      if (thread_name_input) {
        thread_name_input.value = new_thread.name;
      }
    });
  }

  // 3) Handle "Chat Settings" button
  const chat_settings_button = chat_threads_collection.container.querySelector('#smart-chat-chat-settings-button');
  if (chat_settings_button) {
    chat_settings_button.addEventListener('click', async (e) => {
      e.preventDefault();
      open_plugin_settings(plugin.app);
    });
  }

  // 4) Handle "Chat History" button
  const chat_history_button = chat_threads_collection.container.querySelector('#smart-chat-chat-history-button');
  if (chat_history_button) {
    chat_history_button.addEventListener('click', async (e) => {
      e.preventDefault();
      const chat_history_modal = new ChatHistoryModal(plugin);
      chat_history_modal.open();
    });
  }

  /* Help */
  container.querySelector('#smart-chat-help-button')?.addEventListener('click', () =>
    StoryModal.open(plugin, {
      title: 'Getting Started With Smart Chat',
      url: 'https://smartconnections.app/story/smart-connections-getting-started/?utm_source=smart-chat-help#page=chat-interface-1'
    })
  );


  return container;
}

/**
 * Programmatically opens the settings pane for a community plugin in Obsidian.
 * @param {App} app - Obsidian App instance.
 * @returns {Promise<void>}
 */
export async function open_plugin_settings(app) {
  await app.setting.open();
  await app.setting.openTabById('smart-chat');
}

/**
 * Updates the thread name and queues a save.
 * @param {Object} collection
 * @param {Object} thread
 * @param {string} new_name
 */
function rename_thread(collection, thread, new_name) {
  thread.data.name = new_name;

  thread.queue_save();
  collection.process_save_queue();
}
