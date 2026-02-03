/**
 * @module parse_dropped_data
 * Pure helper for the Smart Chat thread drag‑&‑drop handler.
 *
 * @function parse_dropped_data
 * @description
 * Normalises the various `DataTransfer.getData()` payloads that Obsidian /
 * browsers emit during a drag operation into a **Set** of vault‑relative
 * paths.  Fully decoupled from the DOM so it can be unit‑tested.
 *
 * Supported forms (any mix, any order):
 *   • obsidian://open?vault=…&file=PATH
 *   • /absolute/path/on/disk  ← `DataTransfer.files`
 *   • PATH\nPATH\nPATH…       ← `text/plain` / `text/uri-list`
 *
 * @param {DataTransfer} dt  – the native event.dataTransfer object
 * @returns {Set<string>}      vault‑relative paths (deduplicated, decoded)
 */
export function parse_dropped_data (dt) {
  /** @type {Set<string>} */
  const out = new Set();

  /* ─── 1. FileSystem entries ─── */
  if (dt?.files?.length) {
    [...dt.files].forEach(f => {
      const p = f.path || f.name;
      if (p) out.add(p);
    });
  }

  /* helper: split multi‑line payload safely */
  const split_lines = str => (str ?? '')
    .split(/\r?\n/u)
    .map(s => s.trim())
    .filter(Boolean);

  /* ─── 2. uri‑list / plain‑text rows ─── */
  let rows = [
    ...split_lines(dt?.getData('text/uri-list')),
    ...split_lines(dt?.getData('text/plain'))
  ];

  // Flatten missing newlines between obsidian URIs
  // e.g. obsidian://open?...obsidian://open?... → split into separate URIs
  const flatten_obsidian_uris = arr => arr.flatMap(row => {
    if (row.startsWith('obsidian://')) {
      // Split on every obsidian:// except the first
      return row.split(/(?=obsidian:\/\/)/g).map(s => s.trim()).filter(Boolean);
    }
    return [row];
  });

  // Merge split obsidian URIs (e.g. "obsidian:/", "/open?vault=...&file=...")
  const mergedRows = [];
  for (let i = 0; i < rows.length; i++) {
    if (
      rows[i].startsWith('obsidian:') &&
      !rows[i].startsWith('obsidian://') &&
      i + 1 < rows.length &&
      rows[i + 1].startsWith('/')
    ) {
      mergedRows.push(rows[i] + rows[i + 1]);
      i++;
    } else {
      mergedRows.push(rows[i]);
    }
  }
  rows = flatten_obsidian_uris(mergedRows);

  rows.forEach(row => {
    /* a) Obsidian deep link ............................................... */
    if (row.startsWith('obsidian://')) {
      try {
        const url  = new URL(row);
        let file = url.searchParams.get('file'); // already decoded
        if (file) {
          // Add .md if missing extension
          if (!/\.[^./\\]+$/.test(file)) file += '.md';
          out.add(file);
          return;
        }
      } catch (_) {
        // fall-through and attempt manual extraction
      }
      const match = row.match(/file=([^&\s]+)/u);
      if (match) {
        let file = decodeURIComponent(match[1]);
        if (!/\.[^./\\]+$/.test(file)) file += '.md';
        out.add(file);
      }
      return;
    }

    /* b) plain vault‑relative path ........................................ */
    // Add .md if it looks like a bare filename (no extension, no slash)
    let val = row;
    if (
      val &&
      !/[./\\]/.test(val.slice(-4)) && // crude: no .ext or / at end
      !/\.[^./\\]+$/.test(val)
    ) {
      val += '.md';
    }
    out.add(val);
  });
  // console.log('parse_dropped_data out ', out);

  return out;
}
