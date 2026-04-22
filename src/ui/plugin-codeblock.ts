import type SmartConnectionsPlugin from '../main';
import { average_vectors } from '../utils';

function parseCodeblockConfig(source: string): Record<string, string> {
  const config: Record<string, string> = {};

  for (const line of source.trim().split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key) {
      config[key.trim()] = rest.join(':').trim();
    }
  }

  return config;
}

export function registerSmartConnectionsCodeBlock(plugin: SmartConnectionsPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('smart-connections', async (source, el) => {
    if (!plugin.block_collection) {
      el.createEl('p', { text: 'Open connections is loading…', cls: 'osc-state-text' });
      return;
    }

    const config = parseCodeblockConfig(source);
    const limit = parseInt(config.limit || '5', 10);
    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile) return;

    const fileBlocks = plugin.block_collection.all.filter(
      (block) => block.source_key === activeFile.path && block.has_embed(),
    );

    if (fileBlocks.length === 0) {
      el.createEl('p', { text: 'No embedding available for this note.', cls: 'osc-state-text' });
      return;
    }

    await Promise.all(fileBlocks.map((block) => plugin.block_collection!.ensure_entity_vector(block)));
    const loadedBlocks = fileBlocks.filter((block) => block.vec && block.vec.length > 0);
    if (loadedBlocks.length === 0) {
      el.createEl('p', { text: 'No embedding available for this note.', cls: 'osc-state-text' });
      return;
    }

    const avgVec = average_vectors(
      loadedBlocks.map((block) => block.vec).filter((vec): vec is number[] | Float32Array => vec != null),
    );
    loadedBlocks.forEach((block) => block.evictVec?.());

    try {
      const blockKeys = fileBlocks.map((block) => block.key);
      const results = await plugin.block_collection.nearest(avgVec, {
        limit: limit * 3,
        exclude: blockKeys,
      });

      const seen = new Map<string, number>();
      for (const result of results) {
        const key = result.item?.key ?? '';
        const sourcePath = key.split('#')[0] ?? '';
        const score = result.score ?? 0;
        const current = seen.get(sourcePath) ?? Number.NEGATIVE_INFINITY;
        if (sourcePath && score > current) {
          seen.set(sourcePath, score);
        }
      }

      const list = el.createEl('ul', { cls: 'osc-codeblock-results' });
      for (const [path, score] of [...seen.entries()].slice(0, limit)) {
        const li = list.createEl('li');
        const displayPath = path.replace(/\.md$/, '');
        const link = li.createEl('a', {
          text: displayPath.split('/').pop() ?? displayPath,
          cls: 'internal-link',
          attr: { 'data-href': displayPath },
        });
        li.createSpan({ text: ` (${Math.round(score * 100)}%)`, cls: 'osc-score--medium' });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void plugin.open_note(path);
        });
      }
    } catch (error) {
      plugin.logger.error('[SC] Codeblock: failed to load connections:', error);
      el.createEl('p', { text: 'Failed to load connections.', cls: 'osc-state-text' });
    }
  });
}
