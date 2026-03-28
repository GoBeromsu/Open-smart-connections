/**
 * @file path-exclusions.ts
 * @description Source discovery exclusion helpers.
 */

export const DEFAULT_EXCLUDED_FOLDERS = ['node_modules', '.trash', '.git'];

export function isExcludedPath(
  path: string,
  folderExclusions: string = '',
  fileExclusions: string = '',
): boolean {
  const segments = path.split('/');

  for (const segment of segments) {
    if (DEFAULT_EXCLUDED_FOLDERS.includes(segment)) return true;
  }

  if (folderExclusions) {
    const userFolders = folderExclusions.split(',').map((value) => value.trim()).filter(Boolean);
    for (const segment of segments) {
      if (userFolders.includes(segment)) return true;
    }
  }

  if (!fileExclusions) return false;

  const fileName = segments[segments.length - 1];
  if (!fileName) return false;

  const patterns = fileExclusions.split(',').map((value) => value.trim()).filter(Boolean);
  return patterns.some((pattern) => fileName.includes(pattern));
}
