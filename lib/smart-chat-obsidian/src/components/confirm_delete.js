/**********************************************************
 * File: confirm_delete.js  (new)
 * @description
 * Renders an overlay confirmation dialog for deleting a chat thread.
 * If confirmed, runs chat_thread.remove() and reloads the chat UI.
 * If canceled, clears `chat_thread.confirm_deletion`.
**********************************************************/

import { SmartChatView } from '../smart_chat.obsidian.js';

/**
 * @function build_html
 * @description Returns raw HTML for the overlay confirm dialog
 * @param {Object} chat_thread - The chat thread
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(chat_thread, opts = {}) {
  return `
    <div class="smart-chat-confirm-delete-overlay" style="
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(0,0,0,0.6);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 9999;
    ">
      <div class="smart-chat-confirm-delete-dialog" style="
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        padding: 16px;
        border-radius: 6px;
        max-width: 400px;
        text-align: center;
      ">
        <p style="margin-bottom: 12px; font-size: var(--font-ui-medium);">
          Are you sure you want to delete this chat thread?
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="smart-chat-confirm-delete-confirm">
            Confirm
          </button>
          <button class="smart-chat-confirm-delete-cancel">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * @function render
 * @description Builds and returns the DocumentFragment for the confirm-delete overlay
 * @param {Object} chat_thread
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(chat_thread, opts = {}) {
  const html = build_html(chat_thread, opts);
  const frag = this.create_doc_fragment(html);
  post_process.call(this, chat_thread, frag, opts);
  return frag;
}

/**
 * @function post_process
 * @description Attaches event listeners to Confirm / Cancel buttons.
 * @param {Object} chat_thread
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {DocumentFragment}
 */
export function post_process(chat_thread, frag, opts = {}) {
  const confirmOverlay = frag.querySelector('.smart-chat-confirm-delete-overlay');
  if (!confirmOverlay) return frag;

  const confirmBtn = confirmOverlay.querySelector('.smart-chat-confirm-delete-confirm');
  const cancelBtn = confirmOverlay.querySelector('.smart-chat-confirm-delete-cancel');

  // On confirm => chat_thread.remove() + reload chat view
  confirmBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    // Run remove
    chat_thread.delete(); // marks item as deleted, queues save
    await chat_thread.collection.process_save_queue();
    // We can forcibly remove it from the UI as well if needed
    // Then reload the chat
    SmartChatView.open();
  });

  // On cancel => clear confirm_deletion + re-render chat
  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    chat_thread.confirm_deletion = false;
    // Reload the chat view
    SmartChatView.open();
  });

  return frag;
}
