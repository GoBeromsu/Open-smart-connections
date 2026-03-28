import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { DatabaseSync } from 'node:sqlite';

import { ensureSchema } from './node-sqlite-helpers';

const openDatabases = new Map<string, { db: DatabaseSync; closed: boolean }>();

export function closeNodeSqliteDatabases(): void {
  for (const entry of openDatabases.values()) {
    try {
      if (!entry.closed) {
        entry.db.close();
        entry.closed = true;
      }
    } catch (error) {
      console.warn('[NodeSQLite] Failed to close database:', error);
    }
  }
  openDatabases.clear();
}

export function initNodeSqliteDatabase(
  vaultAdapter: unknown,
  configDir: string,
  pluginId: string,
): DatabaseSync {
  const adapter = vaultAdapter as { getBasePath?: () => string };
  const basePath = typeof adapter.getBasePath === 'function'
    ? adapter.getBasePath()
    : (() => {
        throw new Error('[NodeSQLite] vaultAdapter.getBasePath() not available');
      })();
  const absoluteDbPath = join(basePath, configDir, 'plugins', pluginId, `${pluginId}.db`);
  mkdirSync(dirname(absoluteDbPath), { recursive: true });

  const existing = openDatabases.get(absoluteDbPath);
  if (existing && !existing.closed) {
    return existing.db;
  }

  const db = new DatabaseSync(absoluteDbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = OFF');
  ensureSchema(db);
  openDatabases.set(absoluteDbPath, { db, closed: false });
  return db;
}
