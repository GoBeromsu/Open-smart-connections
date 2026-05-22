import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';

export class UnsafeVaultPathError extends Error {
  constructor(reason: string) {
    super(`Unsafe vault path: ${reason}`);
    this.name = 'UnsafeVaultPathError';
  }
}

export function rejectUnsafeVaultPath(notePath: string): void {
  if (!notePath || notePath.includes('\0')) throw new UnsafeVaultPathError('empty_or_nul');
  if (isAbsolute(notePath)) throw new UnsafeVaultPathError('absolute_path');
  for (const variant of encodedPathVariants(notePath)) rejectTraversalSegments(variant);
}

export async function resolveVaultNotePath(
  vaultPath: string,
  notePath: string,
): Promise<string | null> {
  rejectUnsafeVaultPath(notePath);
  const vaultReal = await realpath(vaultPath);
  const candidate = resolve(vaultReal, notePath);
  if (!existsSync(candidate)) return null;
  const candidateReal = await realpath(candidate);
  if (!isUnderDirectory(vaultReal, candidateReal)) {
    throw new UnsafeVaultPathError('symlink_escape');
  }
  return candidateReal;
}

function encodedPathVariants(notePath: string): string[] {
  const variants = [notePath];
  let current = notePath;
  for (let i = 0; i < 3; i++) {
    const decoded = decodePath(current);
    if (decoded === current) break;
    variants.push(decoded);
    current = decoded;
  }
  return variants;
}

function decodePath(notePath: string): string {
  try {
    return decodeURIComponent(notePath);
  } catch {
    throw new UnsafeVaultPathError('malformed_encoding');
  }
}

function rejectTraversalSegments(notePath: string): void {
  const normalized = notePath.replace(/\\/g, '/');
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new UnsafeVaultPathError('traversal_segment');
  }
}

function isUnderDirectory(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !isAbsolute(rel));
}
