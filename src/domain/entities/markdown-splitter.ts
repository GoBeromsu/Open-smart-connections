import type { BlockData } from '../../types/entities';
import type { CachedMetadataShim as CachedMetadata, HeadingCacheShim as HeadingCache } from '../../types/obsidian-shims';
import { create_hash } from '../../utils';

interface BlockRange {
  key: string;
  headings: string[];
  start_line: number;
  end_line: number;
}

async function make_block(
  source_path: string,
  key: string,
  text: string,
  lines: [number, number],
  headings: string[],
): Promise<BlockData> {
  return {
    path: key,
    source_path,
    text,
    length: text.length,
    lines,
    headings,
    embeddings: {},
    last_read: { hash: await create_hash(text) },
  };
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
    return split_by_paragraphs(source_path, lines);
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
    blocks.push(await make_block(source_path, block_key, block_content, [range.start_line, range.end_line], range.headings));

    // Also split content within heading into paragraphs if large enough
    if (block_content.length > 1000) {
      const paragraph_blocks = await split_heading_content_by_paragraphs(
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

    while (heading_stack.length > 0 && heading_stack[heading_stack.length - 1].level >= current.level) {
      heading_stack.pop();
    }
    heading_stack.push({ heading: current.heading, level: current.level });

    if (current.level > max_depth) continue;

    // Block ends before the next heading at the same or shallower level
    let end_line = total_lines - 1;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= current.level) {
        end_line = headings[j].position.start.line - 1;
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

async function split_by_paragraphs(
  source_path: string,
  lines: string[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];

  let current_paragraph: string[] = [];
  let paragraph_start = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) {
      if (current_paragraph.length > 0) {
        paragraphs.push({
          text: current_paragraph.join('\n'),
          start: paragraph_start,
          end: i - 1,
        });
        current_paragraph = [];
      }
      paragraph_start = i + 1;
    } else {
      current_paragraph.push(lines[i]);
    }
  }

  if (current_paragraph.length > 0) {
    paragraphs.push({
      text: current_paragraph.join('\n'),
      start: paragraph_start,
      end: lines.length - 1,
    });
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (para.text.length < 100) continue;

    const block_key = `${source_path}#paragraph-${i + 1}`;
    blocks.push(await make_block(source_path, block_key, para.text, [para.start, para.end], [`paragraph-${i + 1}`]));
  }

  return blocks;
}

// NOTE: The paragraph-splitting logic here intentionally duplicates split_by_paragraphs
// because it differs in: min-length threshold (200 vs 100), boundary conditions
// (heading lines are boundaries here), line offset tracking, and first-line skipping.
async function split_heading_content_by_paragraphs(
  content: string,
  source_path: string,
  start_line_offset: number,
  parent_headings: string[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const lines = content.split('\n');

  // Skip the heading line itself
  const content_lines = lines.slice(1);
  let current_paragraph: string[] = [];
  let paragraph_start = start_line_offset + 1;

  for (let i = 0; i < content_lines.length; i++) {
    const trimmed = content_lines[i].trim();

    // Empty line or heading marks paragraph boundary
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      if (current_paragraph.length > 0) {
        const para_text = current_paragraph.join('\n');

        if (para_text.length > 200) {
          const key = `${source_path}${parent_headings.map(h => `#${h}`).join('')}#paragraph-${blocks.length + 1}`;
          blocks.push(await make_block(source_path, key, para_text, [paragraph_start, start_line_offset + i], [...parent_headings, `paragraph-${blocks.length + 1}`]));
        }

        current_paragraph = [];
      }
      paragraph_start = start_line_offset + i + 2;
    } else {
      current_paragraph.push(content_lines[i]);
    }
  }

  // Add final paragraph
  if (current_paragraph.length > 0) {
    const para_text = current_paragraph.join('\n');
    if (para_text.length > 200) {
      const key = `${source_path}${parent_headings.map(h => `#${h}`).join('')}#paragraph-${blocks.length + 1}`;
      blocks.push(await make_block(source_path, key, para_text, [paragraph_start, start_line_offset + content_lines.length], [...parent_headings, `paragraph-${blocks.length + 1}`]));
    }
  }

  return blocks;
}
