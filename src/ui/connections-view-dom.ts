import type { ConnectionsView } from './ConnectionsView';

export function registerConnectionsDomEvent(
  view: ConnectionsView,
  element: HTMLElement,
  type: string,
  callback: (event: Event) => void,
): void {
  if (typeof view.registerDomEvent === 'function') {
    view.registerDomEvent(element, type as never, callback as never);
    return;
  }
  element.addEventListener(type, callback as EventListener);
}
