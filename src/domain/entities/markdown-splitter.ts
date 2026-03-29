import type { BlockData } from '../../types/entities';
import type { CachedMetadataShim as CachedMetadata, HeadingCacheShim as HeadingCache } from '../../types/obsidian-shims';
import { splitByParagraphs, splitHeadingContentByParagraphs } from './markdown-splitter-paragraphs';

interface BlockRange {
  key: string;
  headings: string[];
  start_line: number;
  end_line: number;
}

/**
 * Parse markdown content into blocks
 * Uses MetadataCache sections for heading-based structure
 * Falls back to paragraph splitting for content between headings
 *
 * @param content Markdown content
 * @param source_path Source file path
 * @param metadata MetadataCache metadata (optional)
 * @param max_depth Maximum heading level to split on (1-6, default 3). Headings deeper than this merge into parent block.
 * @returns Array of block data objects
 */
export async function parse_markdown_blocks(
  content: string,
  source_path: string,
  metadata?: CachedMetadata,
  max_depth: number = 3,
): Promise<BlockData[]> {
  const lines = content.split('\n');
  const headings = metadata?.headings || [];

  if (headings.length === 0) {
    return splitByParagraphs(source_path, lines);
  }
  return split_by_headings(source_path, lines, headings, max_depth);
}

async function split_by_headings(
  source_path: string,
  lines: string[],
  headings: HeadingCache[],
  max_depth: number,
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const heading_ranges = build_heading_ranges(headings, lines.length, max_depth);

  for (const range of heading_ranges) {
    const block_content = lines.slice(range.start_line, range.end_line + 1).join('\n');

    if (block_content.trim().length === 0) continue;

    const block_key = source_path + range.key;
    blocks.push({
      path: block_key,
      source_path,
      text: block_content,
      length: block_content.length,
      lines: [range.start_line, range.end_line],
      headings: range.headings,
      embeddings: {},
      last_read: { hash: await import('../../utils').then(({ create_hash }) => create_hash(block_content)) },
    });

    // Also split content within heading into paragraphs if large enough
    if (block_content.length > 1000) {
      const paragraph_blocks = await splitHeadingContentByParagraphs(
        block_content,
        source_path,
        range.start_line,
        range.headings,
      );
      blocks.push(...paragraph_blocks);
    }
  }

  return blocks;
}

function build_heading_ranges(headings: HeadingCache[], total_lines: number, max_depth: number): BlockRange[] {
  const ranges: BlockRange[] = [];
  const heading_stack: Array<{ heading: string; level: number }> = [];

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    if (!current) continue;

    while (heading_stack.length > 0 && (heading_stack[heading_stack.length - 1]?.level ?? -1) >= current.level) {
      heading_stack.pop();
    }
    heading_stack.push({ heading: current.heading, level: current.level });

    if (current.level > max_depth) continue;

    // Block ends before the next heading at the same or shallower level
    let end_line = total_lines - 1;
    for (let j = i + 1; j < headings.length; j++) {
      const nextHeading = headings[j];
      if (nextHeading && nextHeading.level <= current.level) {
        end_line = nextHeading.position.start.line - 1;
        break;
      }
    }

    const heading_path = heading_stack
      .filter(h => h.level <= max_depth)
      .map(h => h.heading);
    const key = heading_path.map(h => `#${h}`).join('');

    ranges.push({
      key,
      headings: heading_path,
      start_line: current.position.start.line,
      end_line,
    });
  }

  return ranges;
}
