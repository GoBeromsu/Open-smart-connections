import type { BlockData } from '../../types/entities';
import { create_hash } from '../../utils';

async function makeBlock(
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

export async function splitByParagraphs(
  source_path: string,
  lines: string[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];
  let current_paragraph: string[] = [];
  let paragraph_start = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) {
      if (current_paragraph.length > 0) {
        paragraphs.push({ text: current_paragraph.join('\n'), start: paragraph_start, end: i - 1 });
        current_paragraph = [];
      }
      paragraph_start = i + 1;
    } else {
      current_paragraph.push(line);
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
    const paragraph = paragraphs[i];
    if (!paragraph || paragraph.text.length < 100) continue;
    blocks.push(
      await makeBlock(
        source_path,
        `${source_path}#paragraph-${i + 1}`,
        paragraph.text,
        [paragraph.start, paragraph.end],
        [`paragraph-${i + 1}`],
      ),
    );
  }

  return blocks;
}

export async function splitHeadingContentByParagraphs(
  content: string,
  source_path: string,
  start_line_offset: number,
  parent_headings: string[],
): Promise<BlockData[]> {
  const blocks: BlockData[] = [];
  const content_lines = content.split('\n').slice(1);
  let current_paragraph: string[] = [];
  let paragraph_start = start_line_offset + 1;

  for (let i = 0; i < content_lines.length; i++) {
    const line = content_lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      if (current_paragraph.length > 0) {
        const paragraph_text = current_paragraph.join('\n');
        if (paragraph_text.length > 200) {
          const suffix = `#paragraph-${blocks.length + 1}`;
          blocks.push(
            await makeBlock(
              source_path,
              `${source_path}${parent_headings.map((heading) => `#${heading}`).join('')}${suffix}`,
              paragraph_text,
              [paragraph_start, start_line_offset + i],
              [...parent_headings, `paragraph-${blocks.length + 1}`],
            ),
          );
        }
        current_paragraph = [];
      }
      paragraph_start = start_line_offset + i + 2;
    } else {
      current_paragraph.push(line);
    }
  }

  if (current_paragraph.length > 0) {
    const paragraph_text = current_paragraph.join('\n');
    if (paragraph_text.length > 200) {
      const suffix = `#paragraph-${blocks.length + 1}`;
      blocks.push(
        await makeBlock(
          source_path,
          `${source_path}${parent_headings.map((heading) => `#${heading}`).join('')}${suffix}`,
          paragraph_text,
          [paragraph_start, start_line_offset + content_lines.length],
          [...parent_headings, `paragraph-${blocks.length + 1}`],
        ),
      );
    }
  }

  return blocks;
}
