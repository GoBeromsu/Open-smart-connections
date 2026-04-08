import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const root = resolve(__dirname, '..', 'src');
const allowed = [
  ['types', ['types']],
  ['utils', ['utils', 'types']],
  ['domain', ['domain', 'utils', 'types', 'mcp']],
  ['ui', ['ui', 'domain', 'utils', 'types', 'shared', 'mcp', 'main']],
  ['shared', ['shared']],
] as const;
const allowedMap = new Map(allowed);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

function layerOf(file: string): string {
  const rel = relative(root, file);
  const [top] = rel.split('/');
  return top === 'main.ts' ? 'main' : top;
}

function importTargets(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
}

function resolveLayer(file: string, specifier: string): string | null {
  const resolved = resolve(file, '..', specifier);
  const rel = relative(root, resolved);
  if (rel.startsWith('..')) return null;
  const [top] = rel.split('/');
  return top === 'main.ts' ? 'main' : top;
}

describe('architecture layer boundaries', () => {
  it('mechanically enforces the currently trusted lower-layer boundaries', () => {
    const violations: string[] = [];

    for (const file of walk(root)) {
      const sourceLayer = layerOf(file);
      if (sourceLayer === 'main') continue;
      const allowedTargets = allowedMap.get(sourceLayer as 'types' | 'utils' | 'domain' | 'ui' | 'shared');
      if (!allowedTargets) continue;

      for (const specifier of importTargets(file)) {
        const targetLayer = resolveLayer(file, specifier);
        if (!targetLayer || targetLayer === sourceLayer) continue;
        if (!allowedTargets.includes(targetLayer as never)) {
          violations.push(`${relative(root, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
