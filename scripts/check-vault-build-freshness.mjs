import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
const pluginId = 'open-connections';

if (!vaultPath) {
  console.error('OBSIDIAN_VAULT_PATH is required');
  process.exit(1);
}

const distDir = join(process.cwd(), 'dist');
const vaultPluginDir = join(vaultPath, '.obsidian', 'plugins', pluginId);
const distMain = join(distDir, 'main.js');
const distManifest = join(distDir, 'manifest.json');
const vaultMain = join(vaultPluginDir, 'main.js');
const vaultManifest = join(vaultPluginDir, 'manifest.json');

for (const path of [distMain, distManifest, vaultMain, vaultManifest]) {
  if (!existsSync(path)) {
    console.error(`Missing required file: ${path}`);
    process.exit(1);
  }
}

function sha1(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const distManifestJson = readJson(distManifest);
const vaultManifestJson = readJson(vaultManifest);
const mainMatches = sha1(distMain) === sha1(vaultMain);
const manifestMatches = JSON.stringify(distManifestJson) === JSON.stringify(vaultManifestJson);

const result = {
  pluginId,
  vaultPath,
  distVersion: distManifestJson.version,
  vaultVersion: vaultManifestJson.version,
  mainMatches,
  manifestMatches,
  fresh: mainMatches && manifestMatches,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.fresh ? 0 : 1);
