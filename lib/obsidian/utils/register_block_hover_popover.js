import { HoverPopover, MarkdownRenderer, Keymap } from 'obsidian';

export function register_block_hover_popover(parent, target, env, block_key, plugin) {
  target.addEventListener('mouseover', async (ev) => {
    if (Keymap.isModEvent(ev)) {
      const block = env.smart_blocks.get(block_key);
      const markdown = await block?.read();
      if (markdown) {
        const popover = new HoverPopover(parent, target);
        const frag = env.smart_view.create_doc_fragment(`<div class="markdown-embed is-loaded">
                <div class="markdown-embed-content node-insert-event">
                  <div class="markdown-preview-view markdown-rendered node-insert-event show-indentation-guide allow-fold-headings allow-fold-lists">
                    <div class="markdown-preview-sizer markdown-preview-section">
                    </div>
                  </div>
                </div>
              </div>`);
        popover.hoverEl.classList.add('smart-block-popover');
        popover.hoverEl.appendChild(frag);
        const sizer = popover.hoverEl.querySelector('.markdown-preview-sizer');
        MarkdownRenderer.render(plugin.app, markdown, sizer, "/", popover);
      }
    }
  });
}
