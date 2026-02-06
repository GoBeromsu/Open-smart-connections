/**
 * @file setup.ts
 * @description Test setup file for Vitest
 */

import { beforeAll, afterEach, vi } from 'vitest';
import { App } from 'obsidian';

// Note: obsidian module is aliased in vitest.config.ts to ./test/mocks/obsidian.ts

// Setup global test environment
beforeAll(() => {
  // Create a mock app instance
  const mockApp = new App();
  (global as any).app = mockApp;

  // Mock crypto.subtle for hashing tests (if not available in jsdom)
  if (!globalThis.crypto?.subtle) {
    const crypto = require('crypto');
    (globalThis as any).crypto = {
      subtle: {
        digest: async (algorithm: string, data: Uint8Array) => {
          const hash = crypto.createHash('sha256');
          hash.update(Buffer.from(data));
          return hash.digest().buffer;
        },
      },
    };
  }
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});
