import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import test from 'ava';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stub_path = path.join(__dirname, '..', '..', 'node_modules', 'obsidian', 'index.js');
fs.writeFileSync(stub_path, "export const MarkdownRenderer={render:async()=>{}};export const htmlToMarkdown=()=>'';export class Component{};");

const { ObsidianMarkdownSourceContentAdapter } = await import('./obsidian_markdown.js');

const create_adapter = () => {
  const metadata_cache = {
    getFileCache: () => ({
      frontmatter: { tags: ['front'] },
      tags: [{ tag: '#inline' }, { tag: '#front' }],
    }),
  };
  const app = { metadataCache: metadata_cache };
  const env = { main: { app } };
  return new ObsidianMarkdownSourceContentAdapter({
    data: {},
    env,
    file: {},
    collection: { fs: {} },
  });
};

test('get_metadata uses metadataCache tags', async t => {
  const adapter = create_adapter();
  const metadata = await adapter.get_metadata();
  t.deepEqual(metadata.tags.sort(), ['#front', '#inline']);
});
