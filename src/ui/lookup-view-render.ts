import { ButtonComponent, Platform, setIcon } from 'obsidian';

import type SmartConnectionsPlugin from '../main';
import type { ConnectionResult } from '../types/entities';
import { showResultContextMenu } from './result-context-menu';
import {
  formatLookupBlockIndicator,
  formatLookupPath,
  formatLookupTitle,
  scoreTierFor,
} from './lookup-view-format';

interface LookupViewRenderContext {
  app: SmartConnectionsPlugin['app'];
  plugin: SmartConnectionsPlugin;
  resultsContainer: HTMLElement;
  searchMetaEl: HTMLElement;
  lastQuery: string;
  registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void;
  retrySearch: () => void;
}

function clearElement(element: HTMLElement): void {
  if (typeof (element as HTMLElement & { empty?: () => void }).empty === 'function') {
    (element as HTMLElement & { empty: () => void }).empty();
  } else {
    element.replaceChildren();
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  opts: { cls?: string; text?: string; attr?: Record<string, string> } = {},
): HTMLElementTagNameMap[K] {
  const element = parent.ownerDocument.createElement(tag);
  if (opts.cls) element.className = opts.cls;
  if (opts.text) element.textContent = opts.text;
  if (opts.attr) {
    for (const [key, value] of Object.entries(opts.attr)) {
      element.setAttribute(key, value);
    }
  }
  parent.appendChild(element);
  return element;
}

function createDiv(parent: HTMLElement, opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}): HTMLDivElement {
  return createElement(parent, 'div', opts);
}

function createSpan(parent: HTMLElement, opts: { cls?: string; text?: string; attr?: Record<string, string> } = {}): HTMLSpanElement {
  return createElement(parent, 'span', opts);
}

export function handleLookupModelSwitched(view: LookupViewRenderContext): void {
  showLookupEmpty(
    view,
    'Embedding model changed. Results will refresh after active-model embeddings are ready.',
    true,
  );
}

export function renderLookupResults(
  view: LookupViewRenderContext,
  query: string,
  results: ConnectionResult[],
  elapsedMs?: number,
): void {
  clearElement(view.resultsContainer);
  if (!results.length) {
    clearElement(view.searchMetaEl);
    showLookupEmpty(view, `No results found for "${query}"`, false);
    return;
  }

  const parts = [`${results.length} result${results.length === 1 ? '' : 's'}`];
  if (elapsedMs !== undefined) parts.push(`${elapsedMs}ms`);
  view.searchMetaEl.textContent = parts.join(' · ');

  const list = createDiv(view.resultsContainer, { cls: 'osc-results', attr: { role: 'list' } });
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (!result) continue;

    const score = result.score ?? result.sim ?? 0;
    const key = result.item?.key ?? '';
    const fullPath = key.split('#')[0] ?? '';
    const threshold = view.plugin.settings?.smart_view_filter?.highlight_threshold ?? 0.8;
    const tier = scoreTierFor(score, threshold);
    const item = createDiv(list, {
      cls: 'osc-lookup-result',
      attr: {
        role: 'listitem',
        tabindex: '0',
        'aria-label': `${formatLookupTitle(key)} — similarity ${Math.round(score * 100)}%`,
        style: `--osc-lookup-delay: ${index * 30}ms`,
      },
    });

    createDiv(item, { cls: `osc-lookup-result-bar osc-lookup-result-bar--${tier}` });
    const body = createDiv(item, { cls: 'osc-lookup-result-body' });
    const header = createDiv(body, { cls: 'osc-lookup-result-header' });
    createSpan(header, {
      text: formatLookupTitle(key),
      cls: `osc-lookup-result-title${tier === 'high' ? ' osc-lookup-result-title--strong' : ''}`,
    });
    createSpan(header, {
      text: `${Math.round(score * 100)}%`,
      cls: `osc-lookup-result-score osc-lookup-result-score--${tier}`,
    });

    const path = formatLookupPath(key);
    if (path) createDiv(body, { text: path, cls: 'osc-lookup-result-path' });
    const blockIndicator = formatLookupBlockIndicator(key);
    if (blockIndicator) createDiv(body, { text: blockIndicator, cls: 'osc-lookup-result-block-indicator' });

    view.registerDomEvent(item, 'click', (event) => {
      void view.plugin.open_note(key, event as MouseEvent);
    });
    view.registerDomEvent(item, 'keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Enter') {
        void view.plugin.open_note(key);
      } else if (keyEvent.key === 'ArrowDown') {
        keyEvent.preventDefault();
        (item.nextElementSibling as HTMLElement | null)?.focus();
      } else if (keyEvent.key === 'ArrowUp') {
        keyEvent.preventDefault();
        (item.previousElementSibling as HTMLElement | null)?.focus();
      }
    });
    view.registerDomEvent(item, 'contextmenu', (event) => {
      showResultContextMenu(view.app, fullPath, event as MouseEvent);
    });
    view.registerDomEvent(item, 'mouseover', (event) => {
      view.app.workspace.trigger('hover-link', {
        event: event as MouseEvent,
        source: 'open-connections-lookup',
        hoverParent: view,
        targetEl: item,
        linktext: fullPath,
      });
    });
    item.setAttribute('draggable', 'true');
    view.registerDomEvent(item, 'dragstart', (event) => {
      const linkText = key.replace(/\.md$/, '').replace(/\.md#/, '#');
      (event as DragEvent).dataTransfer?.setData('text/plain', `[[${linkText}]]`);
    });
  }
}

export function showLookupLoading(view: LookupViewRenderContext, message = 'Loading...'): void {
  clearElement(view.resultsContainer);
  const wrapper = createDiv(view.resultsContainer, { cls: 'osc-state' });
  createDiv(wrapper, { cls: 'osc-spinner' });
  createElement(wrapper, 'p', { text: message, cls: 'osc-state-text osc-lookup-loading-text' });
}

export function showLookupEmpty(
  view: LookupViewRenderContext,
  message = 'No results',
  clear = true,
): void {
  if (clear) clearElement(view.resultsContainer);
  const wrapper = createDiv(view.resultsContainer, { cls: 'osc-state' });
  const iconEl = createDiv(wrapper, { cls: 'osc-lookup-empty-icon' });
  setIcon(iconEl, 'search');
  createElement(wrapper, 'p', { text: message, cls: 'osc-state-text' });
  const modKey = Platform?.isMacOS || Platform?.isIosApp ? 'Cmd' : 'Ctrl';
  createElement(wrapper, 'p', {
    text: `${modKey}+Shift+L to focus search`,
    cls: 'osc-state-hint',
  });
}

export function showLookupError(view: LookupViewRenderContext, message = 'An error occurred'): void {
  clearElement(view.resultsContainer);
  const wrapper = createDiv(view.resultsContainer, { cls: 'osc-state osc-state--error' });
  const iconEl = createDiv(wrapper, { cls: 'osc-state-icon' });
  setIcon(iconEl, 'alert-circle');
  createElement(wrapper, 'p', { text: message, cls: 'osc-state-text' });
  new ButtonComponent(wrapper).setButtonText('Try again').onClick(() => {
    if (view.lastQuery) {
      view.retrySearch();
    }
  });
}
