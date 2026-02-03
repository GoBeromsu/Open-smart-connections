import { MarkdownRenderer, Component } from 'obsidian';

/**
 * @function build_html
 * @description Builds raw HTML for a user message
 * @param {Object} completion
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(completion, opts = {}) {
  const text = completion.data.user_message || '';
  return `
    <div class="smart-chat-message user">
      <div class="smart-chat-message-content">
        ${text}
      </div>
    </div>
  `;
}

/**
 * @function render
 * @description Builds and renders the component, then calls post_process.
 * @param {Object} completion
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(completion, opts = {}) {
  const html = await build_html.call(this, completion, opts);
  const frag = this.create_doc_fragment(html);
  post_process.call(this, completion, frag, opts);
  return frag;
}

/**
 * @function post_process
 * @description Attach event listeners if needed.
 * @param {Object} completion
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function post_process(completion, frag, opts = {}) {
  const content = frag.querySelector('.smart-chat-message-content');
  this.empty(content);
  const plugin = completion.env.smart_chat_plugin || completion.env.smart_connections_plugin;
  await MarkdownRenderer.render(
    plugin.app, 
    completion.data.user_message,
    content,
    '',
    new Component()
  );
  return frag;
}
