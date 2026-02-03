import { MarkdownRenderer, Component, Notice } from 'obsidian';
import { open_note } from 'obsidian-smart-env/utils/open_note.js';

/**
 * @function build_html
 * @description Builds raw HTML for an assistant message, now including a copy button.
 * @param {Object} completion
 * @param {Object} opts
 * @returns {string}
 */
export async function build_html(completion, opts = {}) {
  // We introduce a small .smart-chat-message-actions area with a copy button
  return `
    <div class="smart-chat-message assistant">
      <div class="smart-chat-message-content"></div>
      <div class="smart-chat-message-actions">
        <span 
          class="smart-chat-message-copy-button" 
          title="Copy raw markdown"
          aria-label="Copy raw markdown to clipboard"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
            viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 17L8 5C8 3.89543 8.89543 3 10 3H18C19.1046 3 20 3.89543 20 5V17"
              stroke="currentColor" />
            <rect x="4" y="7" width="14" height="14" rx="2" stroke="currentColor" />
          </svg>
        </span>
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
  if(opts.await_post_process) return await post_process.call(this, completion, frag, opts);
  else post_process.call(this, completion, frag, opts);
  return frag;
}

/**
 * @function post_process
 * @description
 *  - Renders the final assistant Markdown into .smart-chat-message-content
 *  - Wires up the copy button to copy raw markdown from `completion.response_text`
 *  - Makes links in assistant messages clickable (opens notes or external URLs)
 * @param {Object} completion
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function post_process(completion, frag, opts = {}) {
  const container = frag.querySelector('.smart-chat-message-content');
  const copy_button = frag.querySelector('.smart-chat-message-copy-button');

  /* Render assistant markdown */
  this.empty(container);
  const plugin = completion.env.smart_chat_plugin || completion.env.smart_connections_plugin;
  await MarkdownRenderer.render(
    plugin.app,
    completion.response_text,
    container,
    '',
    new Component()
  );

  /* Copy raw markdown */
  copy_button?.addEventListener('click', async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        console.warn('Clipboard API not available.');
        return;
      }
      await navigator.clipboard.writeText(completion.response_text || '');
      new Notice('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy raw markdown:', err);
    }
  });

  /* Make rendered links clickable */
  container.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    a.addEventListener('click', (e) => {
      e.preventDefault();

      /* External URLs and Obsidian deep links */
      if (/^(https?:|obsidian:)/i.test(href)) {
        if (href.startsWith('http')) {
          window.open(href, 'external');
        } else {
          plugin.app.workspace.openLinkText(href, '/');
        }
        return;
      }

      /* Internal note links */
      open_note(plugin, href, e);
    });
    if(!href.includes('://')) {
      let file_path = a.getAttribute('href');
      if(!file_path.endsWith('.md')) file_path += '.md';
      const file = plugin?.app?.metadataCache?.getFirstLinkpathDest(file_path, '');
      if(!file) return; // console.warn(`No file found for link: ${file_path}`, file);
      /* Draggable links */
      a.addEventListener('dragstart', e => {
        const drag_data = plugin?.app?.dragManager?.dragFile(e, file);
        plugin?.app?.dragManager?.onDragStart(e, drag_data);
      });
      /* Hover link */
      a.addEventListener('mouseover', (e) => {
        const parent = a.parentElement;
        plugin.app.workspace.trigger('hover-link', {
          event: e,
          source: 'smart-chat-view',
          hoverParent: parent,
          targetEl: a,
          linktext: file.path 
        });
      });
    }
  });

  return frag;
}