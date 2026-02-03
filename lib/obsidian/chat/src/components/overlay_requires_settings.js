/**
 * @file overlay_requires_settings.js
 * @description
 * Renders an overlay warning that a required chat model or API key is missing.
 * The user can click 'Open Settings' to jump to the Smart Chat settings.
 */

/**
 * @function build_html
 * @description Returns raw HTML for the overlay
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(opts = {}) {
  return `
    <div class="smart-chat-confirm-missing-config-overlay" style="
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(0,0,0,0.6);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 9999;
    ">
      <div class="smart-chat-confirm-missing-config-dialog" style="
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        padding: 16px;
        border-radius: 6px;
        max-width: 420px;
        text-align: center;
      ">
        <p style="margin-bottom: 12px; font-size: var(--font-ui-medium);">
          ${
            opts?.message
            || "No chat model configured or missing API key. Please update your Smart Chat settings."
          }
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="smart-chat-open-settings">
            Open Settings
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * @function render
 * @description Builds the DocumentFragment for the missing-config overlay
 * @param {Object} plugin - Typically the main plugin instance with env
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(chat_thread, opts = {}) {
  const html = build_html.call(this, opts);
  const frag = this.create_doc_fragment(html);
  post_process.call(this, chat_thread, frag, opts);
  return frag;
}

/**
 * @function post_process
 * @description Attaches event listener to the 'Open Settings' button.
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {DocumentFragment}
 */
export function post_process(chat_thread, frag, opts = {}) {
  const overlayEl = frag.querySelector('.smart-chat-confirm-missing-config-overlay');
  if (!overlayEl) return frag;

  const openSettingsBtn = overlayEl.querySelector('.smart-chat-open-settings');
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Programmatically open Smart Chat settings
      chat_thread.collection.open_settings();
      // Remove the overlay
      overlayEl.remove();
    });
  }

  return frag;
}
