import type { App } from 'obsidian';

import type { SettingsConfigAccessor, SmartConnectionsPlugin } from './settings-types';

export function createSettingsConfigAccessor(
  app: App,
  plugin: SmartConnectionsPlugin,
): SettingsConfigAccessor {
  return {
    getConfig<T>(path: string, fallback: T): T {
      const settings = plugin.settings;
      if (!settings) return fallback;
      const keys = path.split('.');
      let value: unknown = settings;
      for (const key of keys) {
        value = (value as Record<string, unknown>)?.[key];
        if (value === undefined) return fallback;
      }
      return value as T;
    },
    setConfig(path: string, value: unknown): void {
      const settings = plugin.settings;
      if (!settings) return;
      const keys = path.split('.');
      let obj: Record<string, unknown> = settings as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!key) continue;
        if (!obj[key]) obj[key] = {};
        obj = obj[key] as Record<string, unknown>;
      }

      const lastKey = keys[keys.length - 1];
      if (!lastKey) return;
      const oldValue = obj[lastKey];
      obj[lastKey] = value;
      void plugin.saveSettings?.();
      app.workspace.trigger('open-connections:settings-changed', {
        key: path,
        oldValue,
        newValue: value,
      });
    },
  };
}
