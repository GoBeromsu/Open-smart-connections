/**
 * @file entry.ts
 * @description CLI entry point for the standalone Open Connections MCP server.
 *
 * Usage:
 *   node dist/mcp.js <vault-path>                        # stdio transport
 *   node dist/mcp.js <vault-path> --http                 # HTTP on port 27124
 *   node dist/mcp.js <vault-path> --http --port 9999     # HTTP on custom port
 *
 * Reads the plugin's data.json and SQLite database from the vault's config
 * directory (default .obsidian, override with --config-dir), then starts a
 * JSON-RPC server that answers MCP tool calls.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

import type { PluginSettings } from '../types/settings';
import { createStandaloneContext } from './standalone-context';
import { startStdioTransport } from './stdio-transport';
import { startHttpTransport } from './http-transport';

const PLUGIN_ID = 'open-connections';
const DEFAULT_CONFIG_DIR = ['.', 'obsidian'].join('');
const DEFAULT_HTTP_PORT = 27124;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const { vaultPath, configDir, useHttp, port } = parseArgs(process.argv.slice(2));

  const configPath = join(vaultPath, configDir, 'plugins', PLUGIN_ID, 'data.json');
  const dbPath = join(vaultPath, configDir, 'plugins', PLUGIN_ID, `${PLUGIN_ID}.db`);

  assertFileExists(configPath, 'Plugin config not found. Is the plugin installed?');
  assertFileExists(dbPath, 'Plugin database not found. Has the plugin been run at least once?');

  const dataJson = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const settings = dataJson.settings as PluginSettings | undefined;
  if (!settings?.smart_sources?.embed_model) {
    fatal('data.json does not contain valid settings.smart_sources.embed_model.');
  }

  const version = typeof dataJson.version === 'string' ? dataJson.version : 'standalone';
  const ctx = createStandaloneContext(vaultPath, dbPath, settings, version);

  const stats = ctx.getStats();
  console.error(
    `[open-connections] Loaded ${stats.embeddedBlockCount} block vectors ` +
    `from ${stats.embeddedSourceCount} sources.`,
  );

  if (useHttp) {
    startHttpTransport(ctx, port);
  } else {
    console.error('[open-connections] MCP stdio transport ready.');
    startStdioTransport(ctx);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  vaultPath: string;
  configDir: string;
  useHttp: boolean;
  port: number;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const vaultPath = resolve(argv[0]!);
  if (!existsSync(vaultPath)) {
    fatal(`Vault path does not exist: ${vaultPath}`);
  }

  const configDirIdx = argv.indexOf('--config-dir');
  const configDirArg = configDirIdx !== -1 ? argv[configDirIdx + 1] : undefined;
  const configDir = typeof configDirArg === 'string' && configDirArg.length > 0
    ? configDirArg
    : DEFAULT_CONFIG_DIR;

  const useHttp = argv.includes('--http');
  let port = DEFAULT_HTTP_PORT;
  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    const parsed = Number(argv[portIdx + 1]);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      fatal(`Invalid port number: ${argv[portIdx + 1]}`);
    }
    port = parsed;
  }

  return { vaultPath, configDir, useHttp, port };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFileExists(filePath: string, hint: string): asserts filePath {
  if (!existsSync(filePath)) {
    fatal(`${hint}\n  Missing: ${filePath}`);
  }
}

function printUsage(): void {
  console.error(`Usage: node dist/mcp.js <vault-path> [options]

Options:
  --config-dir <dir>  Obsidian config folder name (default: .obsidian)
  --http              Use HTTP transport instead of stdio
  --port <number>     HTTP port (default: ${DEFAULT_HTTP_PORT})
  --help, -h          Show this help message

Examples:
  node dist/mcp.js ~/my-vault
  node dist/mcp.js ~/my-vault --http
  node dist/mcp.js ~/my-vault --http --port 9999`);
}

function fatal(message: string): never {
  console.error(`[open-connections] ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main();
