import { describe, expect, it } from 'vitest';

import { parseMcpSettings } from '../src/mcp/settings';

describe('parseMcpSettings', () => {
  it('returns defaults when the value is missing', () => {
    expect(parseMcpSettings(undefined)).toEqual({
      enabled: false,
      port: 27124,
    });
  });

  it('parses a valid object and clamps the port range', () => {
    expect(parseMcpSettings({ enabled: true, port: '999999' })).toEqual({
      enabled: true,
      port: 65535,
    });
  });

  it('falls back when values are invalid', () => {
    expect(parseMcpSettings({ enabled: 'yes', port: 'oops' })).toEqual({
      enabled: false,
      port: 27124,
    });
  });
});
