import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';

import { isSourceFile } from '../../src/ui/file-watcher';

function makeTFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile & {
    path: string;
    basename: string;
    extension: string;
    stat: { mtime: number; size: number };
  };
  const parts = path.split('/');
  const filename = parts[parts.length - 1] ?? path;
  const dotIndex = filename.lastIndexOf('.');
  file.path = path;
  file.basename = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  file.extension = dotIndex >= 0 ? filename.slice(dotIndex + 1) : '';
  file.stat = { mtime: Date.now(), size: 500 } as never;
  return file;
}

function makePlugin(folderExclusions: string): { settings: { smart_sources: { folder_exclusions: string; file_exclusions: string } } } {
  return {
    settings: {
      smart_sources: {
        folder_exclusions: folderExclusions,
        file_exclusions: '',
      },
    },
  };
}

describe('isSourceFile nested folder exclusions', () => {
  it('rejects files under an excluded nested folder path', () => {
    const plugin = makePlugin('Projects/Archive');
    expect(isSourceFile(makeTFile('Projects/Archive/note.md'), plugin as never)).toBe(false);
  });

  it('does not reject files in sibling folders with similar names', () => {
    const plugin = makePlugin('Projects/Archive');
    expect(isSourceFile(makeTFile('Projects/Archive-2/note.md'), plugin as never)).toBe(true);
  });
});
