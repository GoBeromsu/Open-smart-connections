import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { resolveVaultNotePath, rejectUnsafeVaultPath } from '../src/mcp/vault-path-guard';

describe('MCP standalone vault path guard', () => {
  it('rejects traversal, encoded traversal, absolute paths, and backslash traversal', () => {
    expect(() => rejectUnsafeVaultPath('../secret.md')).toThrow(/Unsafe vault path/);
    expect(() => rejectUnsafeVaultPath('%2e%2e/secret.md')).toThrow(/Unsafe vault path/);
    expect(() => rejectUnsafeVaultPath('%252e%252e/secret.md')).toThrow(/Unsafe vault path/);
    expect(() => rejectUnsafeVaultPath('/tmp/secret.md')).toThrow(/Unsafe vault path/);
    expect(() => rejectUnsafeVaultPath('folder\\..\\secret.md')).toThrow(/Unsafe vault path/);
  });

  it('accepts normal in-vault notes and rejects symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oc-vault-'));
    const vault = join(root, 'vault');
    const outside = join(root, 'outside.md');
    await mkdir(join(vault, 'Folder'), { recursive: true });
    await writeFile(join(vault, 'Folder', 'Note.md'), '# Note');
    await writeFile(outside, '# Secret');
    await symlink(outside, join(vault, 'Folder', 'Escape.md'));

    await expect(resolveVaultNotePath(vault, 'Folder/Note.md')).resolves.toMatch(/Folder.*Note\.md$/);
    await expect(resolveVaultNotePath(vault, 'Folder/Escape.md')).rejects.toThrow(/symlink_escape/);
    await rm(root, { recursive: true, force: true });
  });
});
