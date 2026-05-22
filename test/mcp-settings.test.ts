import { describe, expect, it } from 'vitest';

import { parseMcpSettings } from '../src/mcp/settings';

describe('parseMcpSettings', () => {
  it('returns defaults when the value is missing', () => {
    const settings = parseMcpSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(27124);
    expect(settings.authToken.length).toBeGreaterThanOrEqual(16);
  });

  it('parses a valid object and clamps the port range', () => {
    expect(parseMcpSettings({ enabled: true, port: '999999', authToken: 'x'.repeat(16) })).toEqual({
      enabled: true,
      port: 65535,
      authToken: 'x'.repeat(16),
    });
  });

  it('falls back when values are invalid', () => {
    const settings = parseMcpSettings({ enabled: 'yes', port: 'oops', authToken: 'short' });
    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(27124);
    expect(settings.authToken.length).toBeGreaterThanOrEqual(16);
  });
});
