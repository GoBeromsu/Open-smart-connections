/**
 * @file parse_xml_fragments.ts
 * @description Parse XML fragments into structured objects
 */

/**
 * Coerce string primitives to their actual types
 * Inlined from coerce_primitives.js
 */
function coerce_primitives(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  // null
  if (trimmed === 'null') return null;

  // boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
  }

  // string (unchanged)
  return value;
}

/**
 * Strip wrapping triple backtick fences from a string
 */
function strip_code_fence(raw_input: string): string {
  const fence_re = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i;
  const m = fence_re.exec(raw_input);
  return m ? m[1] : raw_input;
}

/**
 * Parse context for XML element
 */
interface ParseContext {
  tag_name: string;
  node: XmlNode;
  text: string;
  children_map: Record<string, XmlNode | XmlNode[]>;
  verbatim: boolean;
}

/**
 * XML node structure
 */
export interface XmlNode {
  attributes?: Record<string, string | number | boolean | null>;
  contents?: Record<string, XmlNode | XmlNode[]> | string | number | boolean | null;
}

/**
 * Parses XML fragments into a nested plain-object representation.
 *
 * Each XML element becomes a key whose value may contain:
 *   – attributes → an object of coerced attribute values (omitted when empty)
 *   – contents   → either:
 *       • another map of child elements
 *       • a coerced primitive/text value
 *       • null for self-closing or empty elements
 *
 * Repeated sibling tags collapse into arrays. Text outside tags is ignored.
 * Unclosed tags are treated as implicitly closed at end of input.
 * Mismatched closing tags return null (except for verbatim tags).
 *
 * @param xml_input Raw XML string or fragment
 * @returns Structured representation or null if invalid
 */
export function parse_xml_fragments(xml_input: string): Record<string, XmlNode | XmlNode[]> | null {
  if (typeof xml_input !== 'string' || xml_input.trim() === '') {
    return null;
  }

  const stripped_input = strip_code_fence(xml_input);

  // Tags whose contents should be preserved verbatim (raw text)
  const VERBATIM_TAGS = new Set(['think']);

  // Helpers
  const compress_whitespace = (str: string) => str.replace(/\s+/g, ' ').trim();

  const parse_attributes = (str: string): Record<string, string | number | boolean | null> => {
    if (!str) return {};
    const attrs: Record<string, string | number | boolean | null> = {};
    const attr_re = /(\w[\w.\-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;

    while ((m = attr_re.exec(str)) !== null) {
      const [, key, val_dq, val_sq] = m;
      const raw_val = val_dq ?? val_sq;
      attrs[key] = coerce_primitives(raw_val);
    }

    return attrs;
  };

  const attach_child = (map: Record<string, XmlNode | XmlNode[]>, tag: string, node: XmlNode) => {
    if (tag in map) {
      const existing = map[tag];
      map[tag] = Array.isArray(existing) ? [...existing, node] : [existing, node];
    } else {
      map[tag] = node;
    }
  };

  const finalize_node = (ctx: ParseContext) => {
    const text_raw = ctx.verbatim
      ? ctx.text.replace(/^\s*\n/, '').replace(/\s+$/, '')
      : compress_whitespace(ctx.text);

    if (Object.keys(ctx.children_map).length) {
      ctx.node.contents = ctx.children_map;
    } else if (text_raw !== '') {
      ctx.node.contents = ctx.verbatim ? text_raw : coerce_primitives(text_raw);
    } else {
      ctx.node.contents = null;
    }
  };

  // Remove XML comments upfront
  const cleaned = stripped_input.replace(/<!--[\s\S]*?-->/g, '');

  // Tokenize: keep ">" inside text
  const token_re = /<[^>]+>|[^<]+/g;

  const root_map: Record<string, XmlNode | XmlNode[]> = {};
  const stack: ParseContext[] = [];

  let match: RegExpExecArray | null;
  while ((match = token_re.exec(cleaned)) !== null) {
    const token = match[0];

    // Verbatim containers: take everything until explicit close
    if (stack.length) {
      const top = stack[stack.length - 1];
      if (top.verbatim) {
        if (token.startsWith(`</${top.tag_name}`)) {
          stack.pop();
          finalize_node(top);

          if (stack.length === 0) {
            attach_child(root_map, top.tag_name, top.node);
          } else {
            attach_child(stack[stack.length - 1].children_map, top.tag_name, top.node);
          }
          continue;
        }
        top.text += token;
        continue;
      }
    }

    if (token.startsWith('<')) {
      // Tag token
      if (token.startsWith('</')) {
        // Closing tag
        const tag_name = token.slice(2, -1).trim();
        if (!stack.length) return null; // stray close
        const ctx = stack.pop()!;
        if (ctx.tag_name !== tag_name) return null; // mismatched

        finalize_node(ctx);

        if (stack.length === 0) {
          attach_child(root_map, tag_name, ctx.node);
        } else {
          attach_child(stack[stack.length - 1].children_map, tag_name, ctx.node);
        }
      } else {
        // Opening or self-closing
        const self_closing = token.endsWith('/>');
        const body = self_closing ? token.slice(1, -2) : token.slice(1, -1);
        const first_space = body.indexOf(' ');
        const tag_name = first_space === -1 ? body : body.slice(0, first_space);
        const attr_str = first_space === -1 ? '' : body.slice(first_space + 1);

        const attributes = parse_attributes(attr_str);
        const node: XmlNode = Object.keys(attributes).length ? { attributes } : {};

        if (self_closing) {
          node.contents = null;
          if (stack.length === 0) {
            attach_child(root_map, tag_name, node);
          } else {
            attach_child(stack[stack.length - 1].children_map, tag_name, node);
          }
        } else {
          stack.push({
            tag_name,
            node,
            text: '',
            children_map: {},
            verbatim: VERBATIM_TAGS.has(tag_name),
          });
        }
      }
    } else {
      // Text token
      if (stack.length) {
        stack[stack.length - 1].text += token;
      }
      // Text outside all tags is ignored
    }
  }

  // Close any unclosed tags at EOF
  while (stack.length) {
    const ctx = stack.pop()!;
    finalize_node(ctx);

    if (stack.length === 0) {
      attach_child(root_map, ctx.tag_name, ctx.node);
    } else {
      attach_child(stack[stack.length - 1].children_map, ctx.tag_name, ctx.node);
    }
  }

  return Object.keys(root_map).length ? root_map : null;
}
