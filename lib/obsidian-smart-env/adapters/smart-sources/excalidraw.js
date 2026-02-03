import { ObsidianMarkdownSourceContentAdapter } from "./obsidian_markdown.js";

export class ExcalidrawSourceContentAdapter extends ObsidianMarkdownSourceContentAdapter {
  static extensions = ['excalidraw.md'];
  is_media = true; // Excalidraw files are treated as media for rendering
  async read(opts = {}) {
    const full_content = await super.read(opts);
    const BEGIN_LINE_MATCHER = '# Text Elements';
    const END_LINE_MATCHER = '# Drawing';
    // only return content between ## Text Elements and ## Drawing lines
    const text_elements_start = full_content.indexOf(BEGIN_LINE_MATCHER);
    const drawing_lines_start = full_content.indexOf(END_LINE_MATCHER);
    if (text_elements_start === -1 || drawing_lines_start === -1) {
      console.warn('Excalidraw file does not contain expected sections. File: ' + this.item.key);
      this.item.data.last_read.size = 0; // reset size if sections are not found
      return ""; // Return empty string if sections are not found
    }

    // Extract and return the content between the two sections
    const text_content = full_content.slice(text_elements_start + BEGIN_LINE_MATCHER.length, drawing_lines_start).trim();

    // strip "^abc123" from end of each line
    const stripped_refs = text_content
      .split('\n')
      .map(line => {
        if(line.trim() === '%%') return '';
        if(line.trim() === '#') return '';
        // Remove any trailing reference like ^abc123
        return line.replace(/\^[a-z0-9]+$/i, '').trim();
      })
      .filter(Boolean) // filter out empty lines
      .join('\n')
    ;
    this.item.data.last_read.size = stripped_refs.length;
    return stripped_refs;
  }
  get size() {
    if (this.item.data?.last_read?.size) {
      return this.item.data.last_read.size;
    }
    // fallback
    return this.file?.stat?.size || 0;
  }
}