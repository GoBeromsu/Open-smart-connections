import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

import { PluginMcpContext } from '../src/mcp/plugin-context';

function makePlugin(basePath: string, files: Map<string, TFile>, cachedRead = vi.fn()) {
  return {
    ready: true,
    embed_ready: true,
    status_state: 'idle',
    manifest: { version: 'test' },
    logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    getEmbedRuntimeState: vi.fn(),
    app: {
      vault: {
        adapter: { getBasePath: () => basePath },
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        cachedRead,
      },
    },
  } as never;
}

describe('PluginMcpContext path guard', () => {
  it('rejects traversal-like paths before resolving Obsidian files', async () => {
    const cachedRead = vi.fn(async () => 'secret');
    const ctx = new PluginMcpContext(makePlugin('/vault', new Map(), cachedRead));

    expect(ctx.noteExists('../outside.md')).toBe(false);
    await expect(ctx.readNote('notes/%2e%2e/outside.md')).resolves.toBeNull();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('rejects symlink escapes before cachedRead in live plugin mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oc-plugin-mcp-'));
    const vaultPath = join(root, 'vault');
    const outsidePath = join(root, 'outside.md');
    const linkPath = join(vaultPath, 'linked.md');
    await mkdir(vaultPath);
    await writeFile(outsidePath, 'outside secret');
    await symlink(outsidePath, linkPath);

    try {
      const file = new TFile('linked.md');
      const cachedRead = vi.fn(async () => 'outside secret');
      const ctx = new PluginMcpContext(makePlugin(vaultPath, new Map([['linked.md', file]]), cachedRead));

      await expect(ctx.readNote('linked.md')).resolves.toBeNull();
      expect(cachedRead).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
