import type { ConnectionsView } from './ConnectionsView';

export interface ConnectionsSessionState {
  pinnedKeys: string[];
  hiddenKeys: string[];
  paused: boolean;
  pausedPath?: string;
}

export function loadConnectionsSession(view: ConnectionsView): void {
  const saved = (view.plugin.settings as unknown as { _connections_session?: ConnectionsSessionState })._connections_session;
  if (!saved || typeof saved !== 'object') return;
  view.session = {
    pinnedKeys: saved.pinnedKeys ?? [],
    hiddenKeys: saved.hiddenKeys ?? [],
    paused: saved.paused ?? false,
    pausedPath: saved.pausedPath,
  };
}

export async function saveConnectionsSession(view: ConnectionsView): Promise<void> {
  (view.plugin.settings as unknown as { _connections_session?: ConnectionsSessionState })._connections_session = view.session;
  await view.plugin.saveSettings();
}
