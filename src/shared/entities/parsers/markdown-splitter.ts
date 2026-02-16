/**
 * @file markdown-splitter.ts
 * @description Custom markdown block parser using MetadataCache sections
 * Splits markdown into heading-based blocks and paragraph blocks
 */

import type { BlockData } from '../../types/entities';
import type { CachedMetadata, HeadingCache } from 'obsidian';
import { create_hash } from '../../utils';

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
 * @returns Array of block data objects
 */
export async function parse_markdown_blocks(
  content: string,
  source_path: string,
  metadata?: CachedMetadata,
): Promise<BlockData[]> {
  const lines = content.split('\n');
  const blocks: BlockData[] = [];

  // Get heading structure from metadata
  const headings = metadata?.headings || [];

  if (headings.length === 0) {
    // No headings - split by paragraphs
    const paragraph_blocks = await split_by_paragraphs(content, source_path, lines);
    blocks.push(...paragraph_blocks);
  } else {
    // Split by headings
    const heading_blocks = await split_by_headings(content, source_path, lines, headings);
    blocks.push(...heading_blocks);
  }

  return blocks;
}

/**
 * Split content by headings using MetadataCache
 */
async function split_by_headings(
  content: string,
  source_path: string,
  lines: string[],
  headings: HeadingCache[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];

  // Build heading hierarchy
  const heading_ranges = build_heading_ranges(headings, lines.length);

  // Create blocks for each heading range
  for (const range of heading_ranges) {
    const block_content = lines.slice(range.start_line, range.end_line + 1).join('\n');

    // Skip empty blocks
    if (block_content.trim().length === 0) continue;

    // Create block key: path#heading1#heading2#...
    const block_key = source_path + range.key;

    // Calculate hash
    const hash = await create_hash(block_content);

    const block_data: BlockData = {
      path: block_key,
      source_path,
      text: block_content,
      length: block_content.length,
      lines: [range.start_line, range.end_line],
      headings: range.headings,
      embeddings: {},
      last_read: { hash },
    };

    blocks.push(block_data);

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

/**
 * Build heading ranges with hierarchy
 * Preserves #heading1#heading2 format for block keys
 */
function build_heading_ranges(headings: HeadingCache[], total_lines: number): BlockRange[] {
  const ranges: BlockRange[] = [];

  // Stack to track current heading path
  const heading_stack: Array<{ heading: string; level: number }> = [];

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];

    // Update heading stack based on level
    while (heading_stack.length > 0 && heading_stack[heading_stack.length - 1].level >= current.level) {
      heading_stack.pop();
    }

    // Add current heading to stack
    heading_stack.push({ heading: current.heading, level: current.level });

    // Build heading path for key
    const heading_path = heading_stack.map(h => h.heading);
    const key = heading_path.map(h => `#${h}`).join('');

    // Determine end line
    const end_line = next ? next.position.start.line - 1 : total_lines - 1;

    ranges.push({
      key,
      headings: heading_path,
      start_line: current.position.start.line,
      end_line,
    });
  }

  return ranges;
}

/**
 * Split content by paragraphs (for content without headings)
 */
async function split_by_paragraphs(
  content: string,
  source_path: string,
  lines: string[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];

  let current_paragraph: string[] = [];
  let paragraph_start = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line marks paragraph boundary
    if (trimmed.length === 0) {
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
      current_paragraph.push(line);
    }
  }

  // Add final paragraph
  if (current_paragraph.length > 0) {
    paragraphs.push({
      text: current_paragraph.join('\n'),
      start: paragraph_start,
      end: lines.length - 1,
    });
  }

  // Create blocks for paragraphs
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    // Skip small paragraphs
    if (para.text.length < 100) continue;

    // Create block key with paragraph index
    const block_key = `${source_path}#paragraph-${i + 1}`;

    const hash = await create_hash(para.text);

    const block_data: BlockData = {
      path: block_key,
      source_path,
      text: para.text,
      length: para.text.length,
      lines: [para.start, para.end],
      headings: [`paragraph-${i + 1}`],
      embeddings: {},
      last_read: { hash },
    };

    blocks.push(block_data);
  }

  return blocks;
}

/**
 * Split heading content by paragraphs
 * Used for large sections within headings
 */
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
    const line = content_lines[i];
    const trimmed = line.trim();

    // Empty line or heading marks paragraph boundary
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      if (current_paragraph.length > 0) {
        const para_text = current_paragraph.join('\n');

        // Only create block if substantial enough
        if (para_text.length > 200) {
          const block_key = `${source_path}${parent_headings.map(h => `#${h}`).join('')}#paragraph-${blocks.length + 1}`;
          const hash = await create_hash(para_text);

          const block_data: BlockData = {
            path: block_key,
            source_path,
            text: para_text,
            length: para_text.length,
            lines: [paragraph_start, start_line_offset + i],
            headings: [...parent_headings, `paragraph-${blocks.length + 1}`],
            embeddings: {},
            last_read: { hash },
          };

          blocks.push(block_data);
        }

        current_paragraph = [];
      }
      paragraph_start = start_line_offset + i + 2;
    } else {
      current_paragraph.push(line);
    }
  }

  // Add final paragraph
  if (current_paragraph.length > 0) {
    const para_text = current_paragraph.join('\n');
    if (para_text.length > 200) {
      const block_key = `${source_path}${parent_headings.map(h => `#${h}`).join('')}#paragraph-${blocks.length + 1}`;
      const hash = await create_hash(para_text);

      const block_data: BlockData = {
        path: block_key,
        source_path,
        text: para_text,
        length: para_text.length,
        lines: [paragraph_start, start_line_offset + content_lines.length],
        headings: [...parent_headings, `paragraph-${blocks.length + 1}`],
        embeddings: {},
        last_read: { hash },
      };

      blocks.push(block_data);
    }
  }

  return blocks;
}
