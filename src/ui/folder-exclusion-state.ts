import { TFolder, type App } from 'obsidian';

function normalizeFolderPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

export function parseExcludedFolderPaths(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of raw.split(',').map(normalizeFolderPath).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function serializeExcludedFolderPaths(paths: string[]): string {
  return parseExcludedFolderPaths(paths.join(',')).join(', ');
}

export function addExcludedFolderPath(raw: string, folderPath: string): string {
  const next = parseExcludedFolderPaths(raw);
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return serializeExcludedFolderPaths(next);
  if (!next.includes(normalized)) next.push(normalized);
  return serializeExcludedFolderPaths(next);
}

export function removeExcludedFolderPath(raw: string, folderPath: string): string {
  const normalized = normalizeFolderPath(folderPath);
  return serializeExcludedFolderPaths(
    parseExcludedFolderPaths(raw).filter((entry) => entry !== normalized),
  );
}

export function listVaultFolderPaths(app: App): string[] {
  const files = app.vault.getAllLoadedFiles?.() ?? [];
  const configDir = normalizeFolderPath(app.vault.configDir ?? '');
  const folders = files
    .filter((entry): entry is TFolder => entry instanceof TFolder)
    .map((folder) => normalizeFolderPath(folder.path))
    .filter((path) => path.length > 0)
    .filter((path) => !configDir || !path.startsWith(configDir))
    .sort((left, right) => left.localeCompare(right));

  return Array.from(new Set(folders));
}
