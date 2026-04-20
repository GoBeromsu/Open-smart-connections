import type { ConnectionResult } from '../../types/entities';

const DEFAULT_MAX_ENTRIES = 64;

interface CachedEntry {
  fingerprint: string;
  results: readonly ConnectionResult[];
}

export class ConnectionsResultCache {
  private readonly store = new Map<string, CachedEntry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get(path: string, fingerprint: string): readonly ConnectionResult[] | null {
    const entry = this.store.get(path);
    if (!entry || entry.fingerprint !== fingerprint) return null;

    this.store.delete(path);
    this.store.set(path, entry);
    return entry.results;
  }

  set(path: string, fingerprint: string, results: readonly ConnectionResult[]): void {
    if (this.store.has(path)) this.store.delete(path);
    this.store.set(path, { fingerprint, results });

    if (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey) this.store.delete(oldestKey);
    }
  }

  invalidate(path: string): void {
    this.store.delete(path);
  }

  invalidateAll(): void {
    this.store.clear();
  }
}
