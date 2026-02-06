/**
 * @file insert_text_in_chunks.ts
 * @description Insert large text into contenteditable in chunks to avoid blocking
 */

/**
 * Splits text into equally-sized chunks
 * @param text Text to split
 * @param size Chunk size in characters (default 1024)
 * @returns Array of text chunks
 */
export function split_into_chunks(text: string, size: number = 1024): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

/**
 * Converts plain text into an array of DOM nodes,
 * preserving newline semantics inside contenteditable.
 * @param txt Text to convert
 * @returns Array of Text and BR elements
 */
export function text_to_nodes(txt: string): (Text | HTMLBRElement)[] {
  return txt.split('\n').flatMap((part, i, arr) => {
    const nodes: (Text | HTMLBRElement)[] = [document.createTextNode(part)];
    if (i < arr.length - 1) {
      nodes.push(document.createElement('br'));
    }
    return nodes;
  });
}

/**
 * Options for chunk insertion
 */
export interface InsertChunksOptions {
  /** Chunk size in characters (default 1024) */
  chunk_size?: number;
}

/**
 * Non-blocking insertion routine.
 * Inserts large text into contenteditable element in small bursts
 * so the main thread never blocks for more than a single frame.
 *
 * @param el Contenteditable target element
 * @param text Plain-text payload
 * @param opts Options
 */
export function insert_text_in_chunks(
  el: HTMLElement,
  text: string,
  opts: InsertChunksOptions = {},
): void {
  const { chunk_size = 1024 } = opts;
  const chunks = split_into_chunks(text, chunk_size);
  if (!chunks.length) return;

  const sel = window.getSelection();
  const base_range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  let idx = 0;
  const step = () => {
    const chunk = chunks[idx++];
    if (!chunk) return;

    if (base_range) {
      // Create temporary container for nodes
      const temp_container = document.createDocumentFragment();
      text_to_nodes(chunk).forEach(n => temp_container.appendChild(n));

      // Insert at cursor position
      base_range.insertNode(temp_container);
      base_range.collapse(false);
      sel!.removeAllRanges();
      sel!.addRange(base_range);
    } else {
      // Create temporary container for nodes
      const temp_container = document.createDocumentFragment();
      text_to_nodes(chunk).forEach(n => temp_container.appendChild(n));

      // Append to element
      el.appendChild(temp_container);
    }

    window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}
