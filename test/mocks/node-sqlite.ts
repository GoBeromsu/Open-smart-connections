/**
 * @file node-sqlite.ts
 * @description Mock for node:sqlite used in Vitest (jsdom environment).
 * Provides stub implementations of DatabaseSync and StatementSync so that
 * imports of the node-sqlite-data-adapter resolve without error.
 */

class StatementSyncMock {
  run(_params?: unknown[]): unknown { return { changes: 0, lastInsertRowid: 0 }; }
  get(_params?: unknown[]): unknown { return undefined; }
  all(_params?: unknown[]): unknown[] { return []; }
}

export class DatabaseSync {
  private _closed = false;

  constructor(_path?: string, _options?: unknown) {}

  /** Execute raw SQL (no-op in mock) */
  exec(_sql: string): void {}

  prepare(_sql: string): StatementSyncMock {
    return new StatementSyncMock();
  }

  close(): void {
    this._closed = true;
  }
}

export type { StatementSyncMock as StatementSync };
