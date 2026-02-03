/**
 * Registers the ```smart-chat``` code‑block processor.
 * Import this module ONCE from `main.js` (after env is ready).
 */
import { SmartChatCodeblock } from './smart_chat_codeblock.js';

export function register_smart_chat_codeblock(plugin) {
  const lang = 'smart-chat';

  plugin.registerMarkdownCodeBlockProcessor(lang, (src, el, ctx) => {
    const info = ctx.getSectionInfo(el);
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof plugin.app.vault.constructor.TFile)) return;

    const cb = new SmartChatCodeblock({
      plugin,
      file,
      line_start: info.lineStart,
      line_end:   info.lineEnd,
      container_el: el.createEl('div', { cls: 'sc-dynamic-codeblock' }),
      source: src
    });
    cb.build();
  });
}
