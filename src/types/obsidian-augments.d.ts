/**
 * @file obsidian-augments.d.ts
 * @description Module augmentation for custom workspace events.
 * Eliminates the need for `as any` casts on custom event names.
 */

import 'obsidian';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'open-connections:core-ready', callback: () => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-ready', callback: () => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-state-changed', callback: (payload: { phase: string; prev: string }) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-progress', callback: (payload: unknown) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:model-switched', callback: (payload?: unknown) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:settings-changed', callback: (payload: { key: string; oldValue: unknown; newValue: unknown }) => void, ctx?: unknown): EventRef;

    trigger(name: 'open-connections:core-ready'): void;
    trigger(name: 'open-connections:embed-ready'): void;
    trigger(name: 'open-connections:embed-state-changed', payload: { phase: string; prev: string }): void;
    trigger(name: 'open-connections:embed-progress', payload: unknown): void;
    trigger(name: 'open-connections:model-switched', payload?: unknown): void;
    trigger(name: 'open-connections:settings-changed', payload: { key: string; oldValue: unknown; newValue: unknown }): void;
  }

  interface App {
    internalPlugins?: {
      plugins?: {
        sync?: {
          instance?: {
            syncStatus?: string;
            syncing?: boolean;
          };
        };
      };
    };
  }
}
