import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';
import ts from 'typescript';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return basename(full) === 'index.ts' ? [full] : [];
  });
}

describe('index.ts entrypoints', () => {
  it('keep index.ts files as barrel-only entrypoints', () => {
    const root = resolve(__dirname, '..', 'src');
    const violations: string[] = [];

    for (const file of walk(root)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement)) continue;
        violations.push(file.replace(`${root}/`, ''));
        break;
      }
    }

    expect(violations).toEqual([]);
  });
});
