/**
 * @file register_status_bar_context_menu.js
 * @description
 * Adds a native Obsidian right‑click context‑menu to a Smart Env status‑bar
 * element.  The menu exposes an **Inspect active note** action that launches
 * the existing `SmartNoteInspectModal`, allowing developers and users to
 * debug the Smart Source backing the currently‑focused file.
 *
 * The helper is pure / side‑effect‑free except for the single DOM‑listener it
 * returns (handy for tests).  It deliberately avoids new deps, follows
 * functional style, and uses `snake_case`.
 *
 * @param {import('../smart_env.js').SmartEnv} env – initialised Smart Env
 * @param {HTMLElement} status_container – the anchor element created in
 *   `SmartEnv.refresh_status`
 * @returns {Function} – the bound `contextmenu` handler (for unit tests)
 */

import { Menu, Notice } from "obsidian";
import { SmartNoteInspectModal } from "../views/source_inspector.js";
import { EnvStatsModal } from "../modals/env_stats.js";

export function register_status_bar_context_menu(env, status_container, deps = {}) {
  const { Menu: MenuClass = Menu } = deps;
  const plugin = env.main;

  /** @type {(ev: MouseEvent) => void} */
  const on_context_menu = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const menu = new MenuClass(plugin.app);
    menu.addItem((item) =>
      item
        .setTitle("Inspect active note")
        .setIcon("search")
        .onClick(async () => {
          const active_file = plugin.app.workspace.getActiveFile();
          if (!active_file) {
            new Notice("No active note found");
            return;
          }
          const src = env.smart_sources?.get(active_file.path);
          if (!src) {
            new Notice("Active note is not indexed by Smart Environment");
            return;
          }
          new SmartNoteInspectModal(plugin, src).open();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Show stats")
        .setIcon("chart-pie")
        .onClick(() => {
          const modal = new EnvStatsModal(plugin.app, env);
          modal.open();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Export data")
        .setIcon("download")
        .onClick(() => {
          env.export_json();
          new Notice("Smart Env exported");
        }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle('Learn about Community Supporters')
        .setIcon('hand-heart')
        .onClick(() => {
          const url = 'https://smartconnections.app/community-supporters/?utm_source=status-bar';
          window.open(url, '_external');
        }),
    );
    menu.showAtPosition({ x: ev.pageX, y: ev.pageY });
  };

  // Auto‑unregistered on plugin unload
  plugin.registerDomEvent(status_container, "contextmenu", on_context_menu);
  return on_context_menu;
}
