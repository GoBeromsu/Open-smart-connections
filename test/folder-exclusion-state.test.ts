import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';

import {
  addExcludedFolderPath,
  listVaultFolderPaths,
  parseExcludedFolderPaths,
  removeExcludedFolderPath,
  serializeExcludedFolderPaths,
} from '../src/ui/folder-exclusion-state';

describe('folder exclusion state helpers', () => {
  it('parses and normalizes excluded folder paths without duplicates', () => {
    expect(parseExcludedFolderPaths(' Archive , Projects/Alpha/, Archive')).toEqual([
      'Archive',
      'Projects/Alpha',
    ]);
  });

  it('adds an excluded folder path idempotently', () => {
    expect(addExcludedFolderPath('Archive', 'Archive/')).toBe('Archive');
    expect(addExcludedFolderPath('Archive', 'Projects/Beta')).toBe('Archive, Projects/Beta');
  });

  it('removes an excluded folder path cleanly', () => {
    expect(removeExcludedFolderPath('Archive, Projects/Beta', 'Archive')).toBe('Projects/Beta');
  });

  it('serializes normalized excluded folder paths', () => {
    expect(serializeExcludedFolderPaths(['Projects/Beta/', 'Archive', 'Archive'])).toBe('Projects/Beta, Archive');
  });

  it('lists vault folders while excluding root and .obsidian paths', () => {
    const app = {
      vault: {
        configDir: '.obsidian',
        getAllLoadedFiles: () => [
          new TFolder(''),
          new TFolder('.obsidian/plugins'),
          new TFolder('Projects'),
          new TFolder('Projects/Alpha'),
          new TFolder('Archive'),
        ],
      },
    } as any;

    expect(listVaultFolderPaths(app)).toEqual(['Archive', 'Projects', 'Projects/Alpha']);
  });
});
