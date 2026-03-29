import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'obsidian': path.resolve(__dirname, './test/mocks/obsidian.ts'),
      'node:sqlite': path.resolve(__dirname, './test/mocks/node-sqlite.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/shared/**', 'src/main.ts'],
      thresholds: {
        statements: 60,
        branches: 68,
        functions: 50,
      },
    },
  },
});

