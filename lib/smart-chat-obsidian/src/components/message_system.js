import message_system_css from './message_system.css' with { type: 'css' };

/**
 * @function build_html
 * @param {Object} completion - The SmartCompletion item
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(completion, opts = {}) {
  const text = (completion.data.system_message || '(No system prompt set)').trim();
  const line_count = (text.match(/\n/g) || []).length + 1;
  const needs_collapse = line_count > 10;
  // Only add indicator and class if needs_collapse
  return `<div>
    <div class="smart-chat-message system">
      <div class="smart-chat-message-content" style="position:relative;">
        <pre class="expandable-system-message"${needs_collapse ? ' tabindex="0"' : ' style="max-height:none;overflow:visible;cursor:auto;"'}>
${text}
        </pre>
        ${needs_collapse ? `<div class="expand-indicator-bar"><span class="expand-indicator" style="user-select:none;">▼ More</span></div>` : ''}
      </div>
    </div>
  </div>`;
}

function set_collapsed(pre, indicator_bar, collapsed) {
  if (collapsed) {
    pre.classList.add('collapsed');
    pre.style.display = '-webkit-box';
    pre.style.webkitBoxOrient = 'vertical';
    pre.style.webkitLineClamp = '10';
    pre.style.maxHeight = 'calc(10 * 1.4em)';
    pre.style.overflow = 'hidden';
    pre.style.cursor = 'pointer';
    pre.title = 'Click or press Enter/Space to expand';
    pre.style.lineHeight = '1.4em';
    if (indicator_bar) indicator_bar.style.display = '';
  } else {
    pre.classList.remove('collapsed');
    pre.style.display = 'block';
    pre.style.webkitLineClamp = '';
    pre.style.maxHeight = 'none';
    pre.style.overflow = 'visible';
    pre.style.cursor = 'auto';
    pre.title = 'Click or press Enter/Space to collapse';
    pre.style.lineHeight = '1.4em';
    if (indicator_bar) indicator_bar.style.display = 'none';
  }
}

/**
 * @function render
 * @description Builds and renders the system message component, then calls post_process.
 * @param {Object} completion - The SmartCompletion item
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(completion, opts = {}) {
  const html = build_html(completion, opts);
  this.apply_style_sheet(message_system_css);
  const frag = this.create_doc_fragment(html);
  const container = frag.querySelector('.smart-chat-message.system');
  post_process.call(this, completion, container, opts);
  return container;
}

/**
 * @function post_process
 * @description If needed, attaches events or interactive elements in the system message.
 * @param {Object} completion
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {DocumentFragment}
 */
export function post_process(completion, frag, opts = {}) {
  const pre = frag.querySelector('.expandable-system-message');
  const indicator_bar = frag.querySelector('.expand-indicator-bar');
  if (pre && indicator_bar) {
    set_collapsed(pre, indicator_bar, true);
    // Toggle on click
    pre.addEventListener('click', function () {
      const collapsed = pre.style.maxHeight !== 'none';
      set_collapsed(pre, indicator_bar, !collapsed);
    });
    // Toggle on Enter/Space
    pre.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const collapsed = pre.style.maxHeight !== 'none';
        set_collapsed(pre, indicator_bar, !collapsed);
      }
    });
  }
  return frag;
}