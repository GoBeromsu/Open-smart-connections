/**
 * @file commands.ts
 * @description Command registration for Smart Connections plugin
 */

import type { Plugin } from 'obsidian';
import type { BlockCollection } from '../domain/entities';
import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import { ConnectionsView } from './ConnectionsView';
import { LookupView } from './LookupView';
import { getBlockConnections } from './block-connections';

/**
 * Register all plugin commands
 */
export function registerCommands(plugin: Plugin): void {
  // Open connections view
  plugin.addCommand({
    id: 'open-connections-view',
    name: 'Open: Smart Connections view',
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
      if (!p.block_collection || !p.embedding_pipeline) return;
      await p.reembedStaleEntities?.('Command: Refresh embeddings');
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

  // Copy connections as Smart Context
  plugin.addCommand({
    id: 'copy-smart-context',
    name: 'Copy connections as Smart Context',
    callback: async () => {
      const p = plugin as any;
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || !p.block_collection) return;

      const blockCollection = p.block_collection as BlockCollection;
      const hasEmbedded = blockCollection.for_source(activeFile.path).some((b: EmbeddingBlock) => b.vec);
      if (!hasEmbedded) {
        p.notices?.show('no_embedding_for_context');
        return;
      }

      try {
        const results = await getBlockConnections(blockCollection, activeFile.path, { limit: 20 });
        if (!results || results.length === 0) return;

        const lines = results.map(r => {
          const score = Math.round((r.score ?? 0) * 100);
          const sourcePath = ((r.item as EmbeddingBlock).source_key ?? '').replace(/\.md$/, '');
          return `- [[${sourcePath}]] (${score}%)`;
        });

        const contextText = `## Smart Context: ${activeFile.basename}\n\n${lines.join('\n')}`;
        await navigator.clipboard.writeText(contextText);
        p.notices?.show('context_copied');
      } catch (e) {
        console.error('Failed to copy smart context:', e);
      }
    },
  });

  // Random connection
  plugin.addCommand({
    id: 'random-connection',
    name: 'Open random connection',
    callback: async () => {
      const p = plugin as any;
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || !p.block_collection) return;

      const blockCollection = p.block_collection as BlockCollection;
      if (!blockCollection.for_source(activeFile.path).some((b: EmbeddingBlock) => b.vec)) return;

      try {
        const results = await getBlockConnections(blockCollection, activeFile.path, { limit: 20 });
        if (!results || results.length === 0) return;

        const randomIdx = Math.floor(Math.random() * results.length);
        const randomPath = (results[randomIdx].item as EmbeddingBlock).source_key;
        if (randomPath) p.open_note(randomPath);
      } catch (e) {
        console.error('Failed to find random connection:', e);
      }
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
        // Notify kernel that cache was cleared
        p.resetError?.();
      }
    },
  });
}
