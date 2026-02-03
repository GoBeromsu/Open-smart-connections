/**
 * Smart‑Chat dynamic code‑block
 * Renders an existing `SmartChatThread` (or a brand‑new one) inline.
 *
 * @module smart_chat_codeblock
 */

import { TFile } from 'obsidian';

/* ------------------------------------------------------------------ */
/* Pure helpers (unit‑tested)                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse code‑block text → [{ key, done }]
 * @param {string} src
 */
export function parse_block_lines(src = '') {
  return src
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [, status, , key] =
        l.match(/^(chat-(active|done))::\s+\d+\s+(.+)$/) ?? [];
      return status ? { key, done: status === 'chat-done' } : null;
    })
    .filter(Boolean);
}

/**
 * Build a `chat-active:: …` line
 * @param {string} key
 * @param {number} ts
 */
export const make_active_line = (key, ts = Date.now() / 1000 | 0) =>
  `chat-active:: ${ts} ${key}`;

/* ------------------------------------------------------------------ */
/* UI / Obsidian integration                                           */
/* ------------------------------------------------------------------ */

export class SmartChatCodeblock {
  /**
   * @param {{
   *   plugin: import('obsidian').Plugin,
   *   file:   TFile,
   *   line_start: number,
   *   line_end:   number,
   *   container_el: HTMLElement,
   *   source: string
   * }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.env = opts.plugin.env;               // smart‑env
    this.lines = parse_block_lines(opts.source);
  }

  /* --------------------------- public ----------------------------- */

  async build() {
    await this._inflate_missing_lines();

    /* ─── DOM scaffold ──────────────────────────────────────────── */
    const wrap   = this.container_el;
    const topbar = wrap.createEl('div', { cls: 'sc-top-row' });
    const drop   = this._build_dropdown(topbar);
    const done   = topbar.createEl('button', { text: 'Mark done' });
    const body   = wrap.createEl('div');

    done.onclick = () => this._mark_done(drop.value);
    drop.onchange = () => this._render_thread(body, drop.value);

    /* Default selection */
    await this._render_thread(body, drop.value);
  }

  /* ------------------------ private helpers ---------------------- */

  _build_dropdown(parent) {
    const sel = parent.createEl('select');
    if (!this.lines.length) {
      const t = this._new_thread();
      this.lines.push({ key: t.key, done: false });
      this._insert_active_line(t.key);
    }
    this.lines.forEach(({ key, done }) => {
      sel.createEl('option', { text: (done ? '✓ ' : '') + key, value: key });
    });
    return sel;
  }

  async _render_thread(container, key) {
    container.empty();
    const thread = this.env.smart_chat_threads.get(key);
    if (!thread) {
      container.createEl('em', { text: 'Thread not found.' });
      return;
    }
    const frag = await this.env.render_component('thread', thread);
    container.appendChild(frag);
  }

  _new_thread() {
    const t = this.env.smart_chat_threads.create_or_update();
    this.env.smart_chat_threads.active_thread = t;
    return t;
  }

  async _mark_done(key) {
    const idx = this.lines.findIndex(l => l.key === key);
    if (idx === -1 || this.lines[idx].done) return;

    /* a) update in‑memory & re‑render dropdown label */
    this.lines[idx].done = true;
    const sel = this.container_el.querySelector('select');
    sel.options[idx].textContent = '✓ ' + key;

    /* b) rewrite code‑block text */
    await this._modify_file(lines => {
      const i = lines.findIndex(l =>
        l.match(new RegExp(`chat-active::\\s+\\d+\\s+${escape_regex(key)}`)));
      if (i !== -1) lines[i] = lines[i].replace('chat-active', 'chat-done');
    });
  }

  async _inflate_missing_lines() {
    if (this.lines.length) return;
    const t = this._new_thread();
    this.lines = [{ key: t.key, done: false }];
    await this._insert_active_line(t.key);
  }

  async _insert_active_line(key) {
    await this._modify_file(lines => {
      lines.splice(this.line_start + 1, 0, make_active_line(key));
    });
  }

  /**
   * In‑place mutate markdown file within this code‑block region.
   * @param {(lines: string[]) => void} mutator
   */
  async _modify_file(mutator) {
    const raw  = await this.plugin.app.vault.read(this.file);
    const rows = raw.split('\n');
    mutator(rows);
    await this.plugin.app.vault.modify(this.file, rows.join('\n'));
  }
}

/* Utility: simple regex escape */
const escape_regex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');