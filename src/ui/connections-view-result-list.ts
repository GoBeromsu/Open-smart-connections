import { setIcon } from 'obsidian';

import type { ConnectionResult } from '../types/entities';
import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import type { ConnectionsView } from './ConnectionsView';
import { registerConnectionsDomEvent } from './connections-view-dom';
import { scoreTierFor } from './lookup-view-format';
import { showResultContextMenu } from './result-context-menu';
import { saveConnectionsSession } from './connections-view-session';

export function getConnectionsResultSourcePath(result: ConnectionResult): string {
  return (result.item as EmbeddingBlock).source_key ?? result.item.key.split('#')[0] ?? '';
}

export function renderConnectionsResultList(
  view: ConnectionsView,
  list: HTMLElement,
  targetPath: string,
  filtered: ConnectionResult[],
  pinnedSet: Set<string>,
): void {
  for (const [index, result] of filtered.entries()) {
    const score = result.score ?? result.sim ?? 0;
    const blockKey = (result.item as EmbeddingBlock).key ?? '';
    const fullPath = getConnectionsResultSourcePath(result);
    const nameParts = fullPath.replace(/\.md$/, '').split('/');
    const name = nameParts.pop() ?? 'Unknown';
    const breadcrumb = nameParts.length > 0 ? nameParts.join(' / ') : '';
    const lastHeading = blockKey.split('#').pop() ?? '';
    const isPinned = pinnedSet.has(fullPath);
    const scorePercent = Math.round(score * 100);

    const item = list.createDiv({
      cls: `osc-result-item${isPinned ? ' osc-result-item--pinned' : ''}`,
      attr: {
        role: 'listitem',
        tabindex: '0',
        'aria-label': `${name} — ${scorePercent}% similarity`,
      },
    });
    item.style.setProperty('--osc-result-delay', `${Math.min(index * 25, 500)}ms`);

    const threshold = view.plugin.settings?.smart_view_filter?.highlight_threshold ?? 0.8;
    const tier = scoreTierFor(score, threshold);
    const scoreBadge = item.createSpan({ cls: `osc-score osc-score--${tier}` });
    scoreBadge.setText(`${scorePercent}%`);

    const content = item.createDiv({ cls: 'osc-result-content' });
    content.createSpan({ text: name, cls: 'osc-result-title' });
    const headingSuffix = lastHeading && !lastHeading.startsWith('paragraph-') ? lastHeading : '';
    const fullBreadcrumb = [breadcrumb, headingSuffix].filter(Boolean).join(' > ');
    if (fullBreadcrumb) {
      content.createSpan({ text: fullBreadcrumb, cls: 'osc-result-breadcrumb' });
    }
    if (isPinned) {
      const pinIcon = item.createSpan({ cls: 'osc-pin-icon' });
      setIcon(pinIcon, 'pin');
    }

    registerConnectionsDomEvent(view, item, 'click', (event) => {
      void view.openBlockResult(fullPath, lastHeading, event as MouseEvent);
    });
    registerConnectionsDomEvent(view, item, 'keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Enter') {
        void view.openBlockResult(fullPath, lastHeading);
      } else if (keyEvent.key === 'ArrowDown') {
        keyEvent.preventDefault();
        (item.nextElementSibling as HTMLElement | null)?.focus();
      } else if (keyEvent.key === 'ArrowUp') {
        keyEvent.preventDefault();
        (item.previousElementSibling as HTMLElement | null)?.focus();
      }
    });
    registerConnectionsDomEvent(view, item, 'contextmenu', (event) => {
      showResultContextMenu(view.app, fullPath, event as MouseEvent, {
        isPinned,
        onPin: () => {
          if (isPinned) {
            view.session.pinnedKeys = view.session.pinnedKeys.filter((key) => key !== fullPath);
          } else {
            view.session.pinnedKeys.push(fullPath);
          }
          void saveConnectionsSession(view);
          void view.renderView(targetPath);
        },
        onHide: () => {
          view.session.hiddenKeys.push(fullPath);
          void saveConnectionsSession(view);
          void view.renderView(targetPath);
        },
      });
    });
    registerConnectionsDomEvent(view, item, 'mouseover', (event) => {
      view.app.workspace.trigger('hover-link', {
        event: event as MouseEvent,
        source: 'open-connections-view',
        hoverParent: view,
        targetEl: item,
        linktext: fullPath,
      });
    });
    item.setAttribute('draggable', 'true');
    registerConnectionsDomEvent(view, item, 'dragstart', (event) => {
      (event as DragEvent).dataTransfer?.setData('text/plain', `[[${fullPath.replace(/\.md$/, '')}]]`);
    });
  }
}
