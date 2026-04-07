/**
 * @file path-exclusions.ts
 * @description Source discovery exclusion helpers.
 */

export const DEFAULT_EXCLUDED_FOLDERS = ['node_modules', '.trash', '.git'];

function normalizeFolderPattern(value: string): string {
  return value
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

export function isExcludedPath(
  path: string,
  folderExclusions: string = '',
  fileExclusions: string = '',
): boolean {
  const normalizedPath = normalizeFolderPattern(path);
  const segments = normalizedPath.split('/').filter(Boolean);

  for (const segment of segments) {
    if (DEFAULT_EXCLUDED_FOLDERS.includes(segment)) return true;
  }

  if (folderExclusions) {
    const userFolders = folderExclusions
      .split(',')
      .map(normalizeFolderPattern)
      .filter(Boolean);

    for (const folder of userFolders) {
      if (!folder.includes('/')) {
        if (segments.includes(folder)) return true;
        continue;
      }
      if (normalizedPath === folder || normalizedPath.startsWith(`${folder}/`)) {
        return true;
      }
    }
  }

  if (!fileExclusions) return false;

  const fileName = segments[segments.length - 1];
  if (!fileName) return false;

  const patterns = fileExclusions.split(',').map((value) => value.trim()).filter(Boolean);
  return patterns.some((pattern) => fileName.includes(pattern));
}
