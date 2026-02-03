import { MarkdownSourceContentAdapter } from "smart-sources/adapters/markdown_source.js";
import { MarkdownRenderer, htmlToMarkdown, Component } from 'obsidian';

/**
 * Merge tags from frontmatter and Obsidian's metadata cache.
 * @param {string|string[]|undefined} fm_tags
 * @param {{tag: string}[]=} cache_tags
 * @returns {string[]}
 */
function merge_tags(fm_tags, cache_tags = []) {
  const tag_set = new Set();
  if (typeof fm_tags === 'string') {
    fm_tags = fm_tags.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
  }
  if (Array.isArray(fm_tags)) {
    fm_tags.forEach(tag => tag_set.add(tag.startsWith('#') ? tag : `#${tag}`));
  }
  cache_tags.forEach(({ tag }) => tag_set.add(tag));
  return [...tag_set];
}

/**
 * @class ObsidianMarkdownSourceContentAdapter
 * @extends MarkdownSourceContentAdapter
 * @description
 * An adapter for Obsidian markdown files that can optionally render
 * the file content to HTML and convert it back to markdown to capture
 * dynamic transformations (e.g. Dataview).
 */
export class ObsidianMarkdownSourceContentAdapter extends MarkdownSourceContentAdapter {
  /**
   * Returns metadata using Obsidian's metadataCache, merging frontmatter and tags.
   * @async
   * @returns {Promise<Object|undefined>}
   */
  async get_metadata() {
    const app = this.item.env.main.app;
    const cache = app.metadataCache.getFileCache(this.item.file) || {};
    const tags = merge_tags(cache.frontmatter?.tags, cache.tags);
    if (cache.frontmatter) {
      if (tags.length) cache.frontmatter.tags = tags;
      return cache.frontmatter;
    }
    return tags.length ? { tags } : undefined;
  }

  /**
   * Reads the file content. If opts.render_output is true, attempts to use
   * Obsidian's MarkdownRenderer to render the file to HTML, then convert it
   * back to markdown via htmlToMarkdown.
   * @async
   * @param {Object} [opts={}] - Options for reading.
   * @param {boolean} [opts.render_output=false] - If true, render MD -> HTML -> MD.
   * @returns {Promise<string>} The file content (possibly rendered).
   */
  async read(opts = {}) {
    const content = await super.read(opts);
    if (!opts.render_output) {
      return content;
    }

    // Attempt dynamic rendering
    const app = this.item.env.main.app;
    if (!app || !MarkdownRenderer || !htmlToMarkdown) {
      console.warn('Obsidian environment not found; cannot render markdown.');
      return content;
    }

    // Render to HTML
    const container = document.createElement('div');
    // Obsidian's signature: renderMarkdown(markdown, container, sourcePath, plugin)
    await MarkdownRenderer.render(app, content, container, this.item.path, new Component());

    // wait for container to stop changing
    let last_html = container.innerHTML;
    const max_wait = 10000;
    let wait_time = 0;
    let conseq_same = 0;
    let changed = true;
    while (conseq_same < 7) {
      await new Promise(resolve => setTimeout(resolve, 100));
      changed = last_html !== container.innerHTML;
      last_html = container.innerHTML;
      if(!changed) conseq_same++;
      else conseq_same = 0;
      wait_time += 100;
      if (wait_time > max_wait) {
        console.warn('ObsidianMarkdownSourceContentAdapter: Timeout waiting for markdown to render.');
        break;
      }
    }

    // Convert HTML back to MD
    const newMd = htmlToMarkdown(container);
    return newMd;
  }
}

export default {
  collection: null, // No collection adapter needed for markdown sources
  item: ObsidianMarkdownSourceContentAdapter
};
