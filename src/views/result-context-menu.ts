/**
 * @file views/result-context-menu.ts
 * @description Shared context menu for result items in ConnectionsView and LookupView
 */

import { Menu, TFile } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Show a context menu for a result item with standard actions:
 * open in new tab, open to the right, and copy link.
 */
export function showResultContextMenu(app: App, fullPath: string, event: MouseEvent): void {
  const menu = new Menu();

  menu.addItem((i) =>
    i
      .setTitle('Open in new tab')
      .setIcon('external-link')
      .onClick(() => {
        const file = app.vault.getAbstractFileByPath(fullPath);
        if (file instanceof TFile) app.workspace.getLeaf('tab').openFile(file);
      }),
  );

  menu.addItem((i) =>
    i
      .setTitle('Open to the right')
      .setIcon('separator-vertical')
      .onClick(() => {
        const file = app.vault.getAbstractFileByPath(fullPath);
        if (file instanceof TFile) app.workspace.getLeaf('split').openFile(file);
      }),
  );

  menu.addSeparator();

  menu.addItem((i) =>
    i
      .setTitle('Copy link')
      .setIcon('link')
      .onClick(() => {
        navigator.clipboard
          .writeText(`[[${fullPath.replace(/\.md$/, '')}]]`)
          .catch((err) => console.error('Failed to copy link to clipboard:', err));
      }),
  );

  menu.showAtMouseEvent(event);
}
