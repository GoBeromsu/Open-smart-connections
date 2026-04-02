import type SmartConnectionsPlugin from '../main';
import { hydratePluginSettings } from '../domain/plugin-settings';

export async function loadPluginSettings(plugin: SmartConnectionsPlugin): Promise<void> {
  const data = await plugin.loadData() as Record<string, unknown> | null;
  const { settings, removedLegacyKeys } = hydratePluginSettings(data);

  plugin.settings = settings;
  plugin._notices = undefined;
  if (removedLegacyKeys) {
    await savePluginSettings(plugin);
  }
}

export async function savePluginSettings(plugin: SmartConnectionsPlugin): Promise<void> {
  const data = (await plugin.loadData() as Record<string, unknown> | null) ?? {};
  data.settings = plugin.settings;
  await plugin.saveData(data);
}
