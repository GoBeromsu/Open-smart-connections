/**
 * @file embed-settings.ts
 * @description Pure helpers for resolving embed/search adapter settings.
 */

export function getEmbedAdapterSettings(embedSettings?: Record<string, unknown>): Record<string, unknown> {
  if (!embedSettings) return {};
  const adapterType = embedSettings.adapter;
  if (typeof adapterType !== 'string' || adapterType.length === 0) return {};
  const settings = embedSettings[adapterType];
  return settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
}
