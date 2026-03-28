import { create_hash } from '../../utils';
import type { EmbeddingSource } from './EmbeddingSource';
import type { TFileShim as TFile } from '../../types/obsidian-shims';

export async function readEmbeddingSource(source: EmbeddingSource): Promise<string> {
  if (!source.vault || !source.file) return '';
  try {
    return await source.vault.cachedRead(source.file);
  } catch {
    return '';
  }
}

export async function cacheEmbeddingSourceInput(
  source: EmbeddingSource,
  content: string | null = null,
): Promise<void> {
  if (typeof source._embed_input === 'string' && source._embed_input.length > 0) return;
  if (!content) {
    content = await readEmbeddingSource(source);
  }
  if (!content) {
    source._embed_input = '';
    return;
  }

  const breadcrumbs = source.path.split('/').join(' > ').replace('.md', '');
  const max_chars = Math.floor(500 * 3.7);
  source._embed_input = `${breadcrumbs}:\n${content}`.substring(0, max_chars);
}

export async function updateEmbeddingSourceFromFile(
  source: EmbeddingSource,
  file: TFile,
): Promise<void> {
  source.file = file;

  if (source.data.mtime === file.stat.mtime && source.data.size === file.stat.size) {
    return;
  }

  source.data.size = file.stat.size;
  source.data.mtime = file.stat.mtime;

  const hash = (!source.read_hash || !source.vault)
    ? await create_hash(`${file.stat.mtime}-${file.stat.size}`)
    : await create_hash(await source.vault.cachedRead(file));

  if (source.read_hash !== hash) {
    source.read_hash = hash;
    source.queue_embed();
  }
}
