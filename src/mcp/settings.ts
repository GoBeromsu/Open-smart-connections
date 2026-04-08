import { DEFAULT_SETTINGS } from '../domain/config';
import type { McpSettings } from '../types/settings';

const MIN_PORT = 1024;
const MAX_PORT = 65535;

function clampPort(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.mcp.port;
  return Math.max(MIN_PORT, Math.min(MAX_PORT, Math.trunc(parsed)));
}

export function parseMcpSettings(value: unknown): McpSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS.mcp };
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === 'boolean'
      ? record.enabled
      : DEFAULT_SETTINGS.mcp.enabled,
    port: clampPort(record.port),
  };
}
