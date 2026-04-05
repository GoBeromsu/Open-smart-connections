import { DEFAULT_SETTINGS } from './config';
import type { PluginSettings } from '../types/settings';

const LEGACY_GEMINI_MODEL_KEY = 'text-embedding-004';
const DEFAULT_GEMINI_MODEL_KEY = 'gemini-embedding-001';

export function hydratePluginSettings(data: Record<string, unknown> | null): {
  settings: PluginSettings;
  removedLegacyKeys: boolean;
} {
  const loadedSettings = (data?.settings && typeof data.settings === 'object')
    ? { ...(data.settings as Record<string, unknown>) }
    : {};
  let removedLegacyKeys = false;

  if (Object.prototype.hasOwnProperty.call(loadedSettings, 'enable_chat')) {
    delete loadedSettings.enable_chat;
    removedLegacyKeys = true;
  }
  if (Object.prototype.hasOwnProperty.call(loadedSettings, 'smart_chat_threads')) {
    delete loadedSettings.smart_chat_threads;
    removedLegacyKeys = true;
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings) as PluginSettings;

  if (loadedSettings.smart_sources && typeof loadedSettings.smart_sources === 'object') {
    const loaded = loadedSettings.smart_sources as Record<string, unknown>;
    settings.smart_sources = { ...DEFAULT_SETTINGS.smart_sources, ...loaded };
    if (loaded.embed_model && typeof loaded.embed_model === 'object') {
      settings.smart_sources.embed_model = {
        ...DEFAULT_SETTINGS.smart_sources.embed_model,
        ...loaded.embed_model,
      };
      const adapter = settings.smart_sources.embed_model.adapter;
      const defaults = (DEFAULT_SETTINGS.smart_sources.embed_model as Record<string, unknown>)[adapter];
      const saved = (loaded.embed_model as Record<string, unknown>)[adapter];
      if (defaults && typeof defaults === 'object') {
        (settings.smart_sources.embed_model as Record<string, unknown>)[adapter] = {
          ...defaults,
          ...(saved && typeof saved === 'object' ? saved : {}),
        };
      }
    }
  }

  if (loadedSettings.smart_blocks && typeof loadedSettings.smart_blocks === 'object') {
    settings.smart_blocks = {
      ...DEFAULT_SETTINGS.smart_blocks,
      ...(loadedSettings.smart_blocks as Record<string, unknown>),
    };
  }

  if (loadedSettings.smart_view_filter && typeof loadedSettings.smart_view_filter === 'object') {
    settings.smart_view_filter = {
      ...DEFAULT_SETTINGS.smart_view_filter,
      ...(loadedSettings.smart_view_filter as Record<string, unknown>),
    };
  }

  if (loadedSettings.smart_notices && typeof loadedSettings.smart_notices === 'object') {
    settings.smart_notices = {
      ...DEFAULT_SETTINGS.smart_notices,
      ...(loadedSettings.smart_notices as Record<string, unknown>),
    };
  }

  if (loadedSettings.mcp && typeof loadedSettings.mcp === 'object') {
    settings.mcp = {
      ...DEFAULT_SETTINGS.mcp,
      ...(loadedSettings.mcp as Record<string, unknown>),
    };
  }

  const legacyMuted = (settings.smart_notices as Record<string, unknown> | undefined)?.muted;
  if (legacyMuted && typeof legacyMuted === 'object' && Object.keys(legacyMuted).length > 0) {
    const settingsAsRecord = settings as unknown as Record<string, unknown>;
    if (!settingsAsRecord['plugin_notices'] || typeof settingsAsRecord['plugin_notices'] !== 'object') {
      settingsAsRecord['plugin_notices'] = { muted: {} };
    }
    const pluginNotices = settingsAsRecord['plugin_notices'] as Record<string, unknown>;
    if (!pluginNotices['muted'] || typeof pluginNotices['muted'] !== 'object') {
      pluginNotices['muted'] = {};
    }
    const destMuted = pluginNotices['muted'] as Record<string, boolean>;
    for (const [key, value] of Object.entries(legacyMuted as Record<string, unknown>)) {
      if (value === true) destMuted[key] = true;
    }
    settings.smart_notices = { muted: {} };
    removedLegacyKeys = true;
  }

  const upstageAdapter = settings.smart_sources?.embed_model as Record<string, unknown> | undefined;
  if (upstageAdapter?.adapter === 'upstage') {
    let upstageSettings = upstageAdapter['upstage'] as Record<string, unknown> | undefined;
    if (!upstageSettings) {
      upstageSettings = { model_key: 'embedding-passage' };
      upstageAdapter['upstage'] = upstageSettings;
      removedLegacyKeys = true;
    } else if (upstageSettings.model_key && upstageSettings.model_key !== 'embedding-passage') {
      upstageSettings.model_key = 'embedding-passage';
      removedLegacyKeys = true;
    }
  }

  if (upstageAdapter?.adapter === 'gemini') {
    let geminiSettings = upstageAdapter['gemini'] as Record<string, unknown> | undefined;
    if (!geminiSettings) {
      geminiSettings = { model_key: DEFAULT_GEMINI_MODEL_KEY };
      upstageAdapter['gemini'] = geminiSettings;
      removedLegacyKeys = true;
    } else if (!geminiSettings.model_key || geminiSettings.model_key === LEGACY_GEMINI_MODEL_KEY) {
      geminiSettings.model_key = DEFAULT_GEMINI_MODEL_KEY;
      removedLegacyKeys = true;
    }
  }

  return { settings, removedLegacyKeys };
}
