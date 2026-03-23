import { describe, it, expect } from 'vitest';
import { parse_markdown_blocks } from '../src/domain/entities/markdown-splitter';
import type { CachedMetadataShim, HeadingCacheShim } from '../src/types/obsidian-shims';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeading(heading: string, level: number, line: number): HeadingCacheShim {
  return {
    heading,
    level,
    position: {
      start: { line, col: 0, offset: 0 },
      end: { line, col: heading.length + level + 1, offset: 0 },
    },
  };
}

function meta(headings: HeadingCacheShim[]): CachedMetadataShim {
  return { headings };
}

function paragraph(n: number, char = 'a'): string {
  return char.repeat(n);
}

const SOURCE = 'notes/test.md';

// ---------------------------------------------------------------------------
// 1. Empty / minimal content
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — empty / minimal content', () => {
  it('empty string returns empty array', async () => {
    const blocks = await parse_markdown_blocks('', SOURCE);
    expect(blocks).toEqual([]);
  });

  it('whitespace-only content returns empty array', async () => {
    const blocks = await parse_markdown_blocks('   \n\t\n   ', SOURCE);
    expect(blocks).toEqual([]);
  });

  it('short paragraphs (<100 chars) without headings are filtered out', async () => {
    // Each paragraph is 50 chars — below the 100-char threshold
    const content = `${paragraph(50)}\n\n${paragraph(50)}`;
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Paragraph splitting (no headings)
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — paragraph splitting (no headings)', () => {
  it('single long paragraph produces one block with paragraph-1 key', async () => {
    const text = paragraph(150);
    const blocks = await parse_markdown_blocks(text, SOURCE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe(`${SOURCE}#paragraph-1`);
    expect(blocks[0].source_path).toBe(SOURCE);
    expect(blocks[0].text).toBe(text);
    expect(blocks[0].length).toBe(text.length);
    expect(blocks[0].lines).toEqual([0, 0]);
    expect(blocks[0].headings).toEqual(['paragraph-1']);
  });

  it('two long paragraphs produce two blocks with sequential keys', async () => {
    const p1 = paragraph(120);
    const p2 = paragraph(130);
    const content = `${p1}\n\n${p2}`;
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].path).toBe(`${SOURCE}#paragraph-1`);
    expect(blocks[1].path).toBe(`${SOURCE}#paragraph-2`);
    expect(blocks[0].text).toBe(p1);
    expect(blocks[1].text).toBe(p2);
  });

  it('short paragraphs mixed with long ones — only long ones produce blocks', async () => {
    const short = paragraph(50);
    const long = paragraph(150);
    const content = `${short}\n\n${long}\n\n${short}`;
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toHaveLength(1);
    // The long paragraph is paragraph index 2 (1-based), not 1
    expect(blocks[0].path).toBe(`${SOURCE}#paragraph-2`);
    expect(blocks[0].text).toBe(long);
  });

  it('final paragraph with no trailing newline is captured', async () => {
    // No trailing newline — the final paragraph must still be collected
    const p1 = paragraph(120);
    const p2 = paragraph(110);
    const content = `${p1}\n\n${p2}`; // intentionally no trailing \n
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toBe(p2);
  });

  it('line range is correct for multi-line paragraphs', async () => {
    // paragraph that spans lines 0-2
    const lines = ['word '.repeat(25).trim(), 'word '.repeat(25).trim(), 'word '.repeat(25).trim()];
    const content = lines.join('\n');
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual([0, 2]);
  });

  it('line start offsets are correct when blank lines precede a paragraph', async () => {
    const short = paragraph(50);  // skipped
    const long = paragraph(150);
    // short at line 0, blank at line 1, long starts at line 2
    const content = `${short}\n\n${long}`;
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines[0]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Single heading
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — single heading', () => {
  it('h1 heading creates one block with correct path and headings array', async () => {
    const content = '# Introduction\n\nThis is the body of the introduction section.';
    const metadata = meta([makeHeading('Introduction', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe(`${SOURCE}#Introduction`);
    expect(blocks[0].source_path).toBe(SOURCE);
    expect(blocks[0].headings).toEqual(['Introduction']);
  });

  it('block includes all content from heading to end of file', async () => {
    const content = '# My Heading\nLine one\nLine two';
    const metadata = meta([makeHeading('My Heading', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(content);
    expect(blocks[0].lines).toEqual([0, 2]);
  });

  it('block length matches text length', async () => {
    const content = '# Section\nSome body text here.';
    const metadata = meta([makeHeading('Section', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks[0].length).toBe(blocks[0].text!.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Multiple headings at same level
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — multiple headings at same level', () => {
  it('two h2 headings produce two separate blocks', async () => {
    const content = [
      '## Alpha',          // line 0
      'Alpha body.',       // line 1
      '',                  // line 2
      '## Beta',           // line 3
      'Beta body.',        // line 4
    ].join('\n');

    const metadata = meta([
      makeHeading('Alpha', 2, 0),
      makeHeading('Beta', 2, 3),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].path).toBe(`${SOURCE}#Alpha`);
    expect(blocks[1].path).toBe(`${SOURCE}#Beta`);
  });

  it('line ranges do not overlap between consecutive same-level headings', async () => {
    const content = [
      '## Alpha',   // line 0
      'A body.',    // line 1
      '## Beta',    // line 2
      'B body.',    // line 3
    ].join('\n');

    const metadata = meta([
      makeHeading('Alpha', 2, 0),
      makeHeading('Beta', 2, 2),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks).toHaveLength(2);
    const [alpha, beta] = blocks;
    // Alpha must end strictly before Beta starts
    expect(alpha.lines![1]).toBeLessThan(beta.lines![0]);
  });

  it('each block has the correct heading path', async () => {
    const content = '## One\nbody\n## Two\nbody';
    const metadata = meta([
      makeHeading('One', 2, 0),
      makeHeading('Two', 2, 2),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks[0].headings).toEqual(['One']);
    expect(blocks[1].headings).toEqual(['Two']);
  });
});

// ---------------------------------------------------------------------------
// 5. Nested headings
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — nested headings', () => {
  it('h1 > h2 > h3 produces a block per heading with full path key', async () => {
    const content = [
      '# Top',         // line 0
      'Intro.',        // line 1
      '## Middle',     // line 2
      'Mid body.',     // line 3
      '### Leaf',      // line 4
      'Leaf body.',    // line 5
    ].join('\n');

    const metadata = meta([
      makeHeading('Top', 1, 0),
      makeHeading('Middle', 2, 2),
      makeHeading('Leaf', 3, 4),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    // Each heading at depth <= 3 (default) gets its own block
    const paths = blocks.map(b => b.path);
    expect(paths).toContain(`${SOURCE}#Top`);
    expect(paths).toContain(`${SOURCE}#Top#Middle`);
    expect(paths).toContain(`${SOURCE}#Top#Middle#Leaf`);
  });

  it('h1 block spans sub-headings up to the next h1 (or EOF)', async () => {
    const content = [
      '# Root',        // line 0
      'Root body.',    // line 1
      '## Child',      // line 2
      'Child body.',   // line 3
    ].join('\n');

    const metadata = meta([
      makeHeading('Root', 1, 0),
      makeHeading('Child', 2, 2),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    const root = blocks.find(b => b.path === `${SOURCE}#Root`);
    expect(root).toBeDefined();
    // Root block ends at last line (3) because there's no sibling h1
    expect(root!.lines![1]).toBe(3);
  });

  it('leaf block headings array reflects full ancestor path', async () => {
    const content = [
      '# A',   // line 0
      '## B',  // line 1
      '### C', // line 2
      'body',  // line 3
    ].join('\n');

    const metadata = meta([
      makeHeading('A', 1, 0),
      makeHeading('B', 2, 1),
      makeHeading('C', 3, 2),
    ]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    const leaf = blocks.find(b => b.path === `${SOURCE}#A#B#C`);
    expect(leaf).toBeDefined();
    expect(leaf!.headings).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// 6. max_depth parameter
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — max_depth parameter', () => {
  const nestedContent = [
    '# H1',       // line 0
    '## H2',      // line 1
    '### H3',     // line 2
    'body',       // line 3
  ].join('\n');

  const nestedMeta = meta([
    makeHeading('H1', 1, 0),
    makeHeading('H2', 2, 1),
    makeHeading('H3', 3, 2),
  ]);

  it('default max_depth=3 creates blocks for h1, h2, and h3', async () => {
    const blocks = await parse_markdown_blocks(nestedContent, SOURCE, nestedMeta);
    const paths = blocks.map(b => b.path);
    expect(paths).toContain(`${SOURCE}#H1`);
    expect(paths).toContain(`${SOURCE}#H1#H2`);
    expect(paths).toContain(`${SOURCE}#H1#H2#H3`);
  });

  it('max_depth=2 suppresses h3 block', async () => {
    const blocks = await parse_markdown_blocks(nestedContent, SOURCE, nestedMeta, 2);
    const paths = blocks.map(b => b.path);
    expect(paths).toContain(`${SOURCE}#H1`);
    expect(paths).toContain(`${SOURCE}#H1#H2`);
    expect(paths).not.toContain(`${SOURCE}#H1#H2#H3`);
  });

  it('max_depth=1 only creates h1 block', async () => {
    const blocks = await parse_markdown_blocks(nestedContent, SOURCE, nestedMeta, 1);
    const paths = blocks.map(b => b.path);
    expect(paths).toContain(`${SOURCE}#H1`);
    expect(paths).not.toContain(`${SOURCE}#H1#H2`);
    expect(paths).not.toContain(`${SOURCE}#H1#H2#H3`);
  });

  it('max_depth=2 h2 block end_line extends through suppressed h3 content', async () => {
    const blocks = await parse_markdown_blocks(nestedContent, SOURCE, nestedMeta, 2);
    const h2 = blocks.find(b => b.path === `${SOURCE}#H1#H2`);
    expect(h2).toBeDefined();
    // H2 must encompass lines 1-3 (the h3 heading and body are merged in)
    expect(h2!.lines![1]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 7. Large heading sections (>1000 chars) → paragraph sub-blocks
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — large heading sections produce paragraph sub-blocks', () => {
  it('heading section >1000 chars produces paragraph sub-blocks', async () => {
    // Build a heading section with two large paragraphs separated by a blank line.
    // Each paragraph must be >200 chars (sub-block threshold) and the total section
    // must exceed 1000 chars to trigger paragraph splitting.
    const p1 = paragraph(510);
    const p2 = paragraph(510);
    const body = `${p1}\n\n${p2}`;
    const content = `# Big Section\n${body}`;

    const metadata = meta([makeHeading('Big Section', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);

    // Must include the heading block itself
    const heading_block = blocks.find(b => b.path === `${SOURCE}#Big Section`);
    expect(heading_block).toBeDefined();

    // Must also include paragraph sub-blocks
    const sub_blocks = blocks.filter(b => b.path.includes('#paragraph-'));
    expect(sub_blocks.length).toBeGreaterThan(0);
  });

  it('sub-block keys follow format path#Heading#paragraph-N', async () => {
    const p1 = paragraph(510);
    const p2 = paragraph(510);
    const content = `# Section\n${p1}\n\n${p2}`;

    const metadata = meta([makeHeading('Section', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);

    const sub_blocks = blocks.filter(b => b.path.includes('#paragraph-'));
    for (const block of sub_blocks) {
      expect(block.path).toMatch(new RegExp(`^${SOURCE.replace('.', '\\.')}#Section#paragraph-\\d+$`));
    }
  });

  it('sub-block paragraphs under 200 chars are excluded', async () => {
    // Each paragraph is exactly 150 chars — above the 100 threshold for top-level,
    // but below the 200 threshold required inside a heading section.
    // Six 170-char paragraphs push the section past 1000 chars to trigger splitting,
    // but each paragraph stays under the 200-char sub-block threshold.
    const long_body = paragraph(170) + '\n\n' + paragraph(170) + '\n\n' + paragraph(170) + '\n\n' + paragraph(170) + '\n\n' + paragraph(170) + '\n\n' + paragraph(170);
    const long_content = `# Heading\n${long_body}`;

    const metadata2 = meta([makeHeading('Heading', 1, 0)]);
    const blocks = await parse_markdown_blocks(long_content, SOURCE, metadata2);

    const sub_blocks = blocks.filter(b => b.path.includes('#paragraph-'));
    // 170-char paragraphs are below the 200-char sub-paragraph threshold → no sub-blocks
    expect(sub_blocks).toHaveLength(0);
  });

  it('sub-block headings array extends parent headings', async () => {
    const p1 = paragraph(510);
    const p2 = paragraph(510);
    const content = `# Parent\n${p1}\n\n${p2}`;

    const metadata = meta([makeHeading('Parent', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);

    const sub_blocks = blocks.filter(b => b.path.includes('#paragraph-'));
    for (const block of sub_blocks) {
      expect(block.headings![0]).toBe('Parent');
      expect(block.headings![1]).toMatch(/^paragraph-\d+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Block field correctness
// ---------------------------------------------------------------------------

describe('parse_markdown_blocks — block field correctness', () => {
  it('every block has required fields with correct types', async () => {
    const content = '# Header\nSome content here.';
    const metadata = meta([makeHeading('Header', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      expect(typeof block.path).toBe('string');
      expect(typeof block.source_path).toBe('string');
      expect(typeof block.text).toBe('string');
      expect(typeof block.length).toBe('number');
      expect(Array.isArray(block.lines)).toBe(true);
      expect(block.lines).toHaveLength(2);
      expect(Array.isArray(block.headings)).toBe(true);
      expect(typeof block.embeddings).toBe('object');
      expect(block.embeddings).not.toBeNull();
      expect(typeof block.last_read).toBe('object');
      expect(typeof block.last_read!.hash).toBe('string');
    }
  });

  it('embeddings field is an empty object on new blocks', async () => {
    const content = '# Section\nBody text.';
    const metadata = meta([makeHeading('Section', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    expect(blocks[0].embeddings).toEqual({});
  });

  it('last_read.hash is a 64-char hex string (SHA-256)', async () => {
    const content = '# Section\nBody text content here.';
    const metadata = meta([makeHeading('Section', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    const hash = blocks[0].last_read!.hash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('length field equals text length', async () => {
    const content = paragraph(150);
    const blocks = await parse_markdown_blocks(content, SOURCE);
    expect(blocks[0].length).toBe(blocks[0].text!.length);
  });

  it('source_path always equals the passed source_path argument', async () => {
    const custom_source = 'deep/nested/file.md';
    const content = '# Heading\nContent.';
    const metadata = meta([makeHeading('Heading', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, custom_source, metadata);
    for (const block of blocks) {
      expect(block.source_path).toBe(custom_source);
    }
  });

  it('path starts with source_path', async () => {
    const content = '# Heading\nContent.';
    const metadata = meta([makeHeading('Heading', 1, 0)]);
    const blocks = await parse_markdown_blocks(content, SOURCE, metadata);
    for (const block of blocks) {
      expect(block.path.startsWith(SOURCE)).toBe(true);
    }
  });

  it('different content produces different hashes', async () => {
    const a = await parse_markdown_blocks(paragraph(150), SOURCE);
    const b = await parse_markdown_blocks(paragraph(150, 'b'), SOURCE);
    expect(a[0].last_read!.hash).not.toBe(b[0].last_read!.hash);
  });
});
