/**
 * @file commands.ts
 * @description Command registration for Smart Connections plugin
 */

import type { Plugin } from 'obsidian';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from './views/connections_view';
import { LookupView, LOOKUP_VIEW_TYPE } from './views/LookupView';

/**
 * Register all plugin commands
 */
export function registerCommands(plugin: Plugin): void {
  // Open connections view
  plugin.addCommand({
    id: 'open-connections-view',
    name: 'Open: Connections view',
    callback: () => {
      ConnectionsView.open(plugin.app.workspace);
    },
  });

  // Find connections to current note
  plugin.addCommand({
    id: 'find-connections',
    name: 'Find connections to current note',
    callback: () => {
      const view = ConnectionsView.get_view(plugin.app.workspace);
      if (view) {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (activeFile) {
          view.renderView(activeFile.path);
        }
      } else {
        ConnectionsView.open(plugin.app.workspace);
      }
    },
  });

  // Open lookup view
  plugin.addCommand({
    id: 'open-lookup-view',
    name: 'Open: Smart Lookup',
    callback: () => {
      LookupView.open(plugin.app.workspace);
    },
  });

  // Refresh embeddings
  plugin.addCommand({
    id: 'refresh-embeddings',
    name: 'Refresh embeddings',
    callback: async () => {
      const env = (plugin as any).env;
      if (env?.smart_sources) {
        await env.smart_sources.process_source_import_queue?.({ force: true });
      }
    },
  });

  // Clear cache
  plugin.addCommand({
    id: 'clear-cache',
    name: 'Clear embedding cache',
    callback: async () => {
      const env = (plugin as any).env;
      if (env?.smart_sources) {
        for (const key of env.smart_sources.keys || []) {
          const source = env.smart_sources.get(key);
          if (source?.data) {
            delete source.data.vec;
            delete source.data.last_import;
          }
        }
        await env.smart_sources.save();
      }
    },
  });
}
