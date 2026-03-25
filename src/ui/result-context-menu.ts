/**
 * @file result-context-menu.ts
 * @description Shared context menu for result items in ConnectionsView and LookupView
 */

import { Menu, TFile } from 'obsidian';
import type { App } from 'obsidian';

export interface ConnectionActions {
  isPinned?: boolean;
  onPin?: () => void;
  onHide?: () => void;
}

/**
 * Show a context menu for a result item with standard actions:
 * open in new tab, open to the right, copy link, pin/hide.
 */
export function showResultContextMenu(
  app: App,
  fullPath: string,
  event: MouseEvent,
  actions?: ConnectionActions,
): void {
  const menu = new Menu();

  menu.addItem((i) =>
    i
      .setTitle('Open in new tab')
      .setIcon('external-link')
      .onClick(() => {
        const file = app.vault.getAbstractFileByPath(fullPath);
        if (file instanceof TFile) void app.workspace.getLeaf('tab').openFile(file);
      }),
  );

  menu.addItem((i) =>
    i
      .setTitle('Open to the right')
      .setIcon('separator-vertical')
      .onClick(() => {
        const file = app.vault.getAbstractFileByPath(fullPath);
        if (file instanceof TFile) void app.workspace.getLeaf('split').openFile(file);
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
          .catch((_err: unknown) => { /* clipboard write failure — no logger available at this scope */ });
      }),
  );

  if (actions) {
    menu.addSeparator();

    if (actions.onPin) {
      menu.addItem((i) =>
        i
          .setTitle(actions.isPinned ? 'Unpin' : 'Pin to top')
          .setIcon(actions.isPinned ? 'pin-off' : 'pin')
          .onClick(() => actions.onPin!()),
      );
    }

    if (actions.onHide) {
      menu.addItem((i) =>
        i
          .setTitle('Hide connection')
          .setIcon('eye-off')
          .onClick(() => actions.onHide!()),
      );
    }
  }

  menu.showAtMouseEvent(event);
}
