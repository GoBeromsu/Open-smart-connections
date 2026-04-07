import { describe, expect, it } from 'vitest';

import { isExcludedPath } from '../src/utils/path-exclusions';

describe('isExcludedPath', () => {
  it('keeps exact folder-name exclusions working', () => {
    expect(isExcludedPath('Projects/Archive/note.md', 'Archive', '')).toBe(true);
  });

  it('matches nested folder-path exclusions', () => {
    expect(isExcludedPath('Projects/Archive/note.md', 'Projects/Archive', '')).toBe(true);
  });

  it('normalizes trailing slashes in folder exclusions', () => {
    expect(isExcludedPath('Projects/Archive/note.md', 'Projects/Archive/', '')).toBe(true);
  });

  it('does not over-match sibling folders', () => {
    expect(isExcludedPath('Projects/Archive-2/note.md', 'Projects/Archive', '')).toBe(false);
  });

  it('keeps file exclusions unchanged', () => {
    expect(isExcludedPath('Projects/Archive/note.md', '', 'note')).toBe(true);
  });

  it('keeps default excluded folders working', () => {
    expect(isExcludedPath('node_modules/pkg/index.md', '', '')).toBe(true);
  });
});
