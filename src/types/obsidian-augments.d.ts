/**
 * @file obsidian-augments.d.ts
 * @description Module augmentation for custom workspace events.
 * Eliminates the need for `as any` casts on custom event names.
 */

import { EventRef } from 'obsidian';
import type { EmbedProgressEventPayload, EmbedStateChangePayload } from './embed-runtime';

declare module 'obsidian' {
  interface Workspace {
    on(name: 'open-connections:core-ready', callback: () => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-ready', callback: () => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-state-changed', callback: (payload: EmbedStateChangePayload) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:embed-progress', callback: (payload: EmbedProgressEventPayload) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:model-switched', callback: (payload?: unknown) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:settings-changed', callback: (payload: { key: string; oldValue: unknown; newValue: unknown }) => void, ctx?: unknown): EventRef;
    on(name: 'open-connections:discovery-complete', callback: () => void, ctx?: unknown): EventRef;

    trigger(name: 'open-connections:core-ready'): void;
    trigger(name: 'open-connections:embed-ready'): void;
    trigger(name: 'open-connections:embed-state-changed', payload: EmbedStateChangePayload): void;
    trigger(name: 'open-connections:embed-progress', payload: EmbedProgressEventPayload): void;
    trigger(name: 'open-connections:model-switched', payload?: unknown): void;
    trigger(name: 'open-connections:settings-changed', payload: { key: string; oldValue: unknown; newValue: unknown }): void;
    trigger(name: 'open-connections:discovery-complete'): void;

    // Obsidian built-in events used by our views
    trigger(name: 'hover-link', payload: { event: MouseEvent; source: string; hoverParent: unknown; targetEl: HTMLElement; linktext: string }): void;
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
