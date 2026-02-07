/**
 * @file commands.ts
 * @description Command registration for Smart Connections plugin
 */

import type { Plugin } from 'obsidian';
import { ConnectionsView } from './views/ConnectionsView';
import { LookupView } from './views/LookupView';

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
      const view = ConnectionsView.getView(plugin.app.workspace);
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
      const p = plugin as any;
      if (!p.source_collection || !p.embedding_pipeline) return;
      await p.reembedStaleEntities?.('Command: Refresh embeddings');
    },
  });

  plugin.addCommand({
    id: 'stop-embedding',
    name: 'Stop embedding',
    callback: () => {
      const p = plugin as any;
      p.requestEmbeddingStop?.('Command: Stop embedding');
    },
  });

  plugin.addCommand({
    id: 'resume-embedding',
    name: 'Resume embedding',
    callback: async () => {
      const p = plugin as any;
      await p.resumeEmbedding?.('Command: Resume embedding');
    },
  });

  plugin.addCommand({
    id: 'reembed-stale-entities',
    name: 'Re-embed stale entities',
    callback: async () => {
      const p = plugin as any;
      await p.reembedStaleEntities?.('Command: Re-embed stale entities');
    },
  });

  // Clear cache
  plugin.addCommand({
    id: 'clear-cache',
    name: 'Clear embedding cache',
    callback: async () => {
      const p = plugin as any;
      if (p.source_collection) {
        for (const source of p.source_collection.all) {
          source.remove_embeddings();
        }
        if (p.block_collection) {
          for (const block of p.block_collection.all) {
            block.remove_embeddings();
          }
        }
        await p.source_collection.data_adapter?.save();
        if (p.block_collection) {
          await p.block_collection.data_adapter?.save();
        }
      }
    },
  });
}
