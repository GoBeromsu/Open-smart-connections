/**
 * @file user-state.ts
 * @description User state management: install tracking, update checks, gitignore helpers
 */

import type SmartConnectionsPlugin from '../main';
import { ConnectionsView } from './ConnectionsView';
import { determine_installed_at } from '../utils';

export async function loadUserState(plugin: SmartConnectionsPlugin): Promise<void> {
  plugin._installed_at = null;
  const data = await plugin.loadData();

  if (migrateInstalledAtFromLocalStorage(plugin)) return;

  if (data && typeof data.installed_at !== 'undefined') {
    plugin._installed_at = data.installed_at;
  }

  const dataCtime = await getDataJsonCreatedAt(plugin);
  const resolved = determine_installed_at(plugin._installed_at, dataCtime);
  if (typeof resolved === 'number' && resolved !== plugin._installed_at) {
    await saveInstalledAt(plugin, resolved);
  }
}

export async function getDataJsonCreatedAt(plugin: SmartConnectionsPlugin): Promise<number | null> {
  try {
    const path = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/data.json`;
    const stat = await plugin.app.vault.adapter.stat(path);
    return stat?.ctime ?? null;
  } catch {
    return null;
  }
}

export function migrateInstalledAtFromLocalStorage(plugin: SmartConnectionsPlugin): boolean {
  const key = 'smart_connections_new_user';
  const stored = plugin.app.loadLocalStorage(key);
  if (stored !== null && stored !== undefined) {
    const oldValue = stored !== 'false';
    if (!oldValue) {
      plugin._installed_at = Date.now();
      saveInstalledAt(plugin, plugin._installed_at);
    }
    plugin.app.saveLocalStorage(key, null);
    return true;
  }
  return false;
}

export async function saveInstalledAt(plugin: SmartConnectionsPlugin, value: number): Promise<void> {
  plugin._installed_at = value;
  const data = (await plugin.loadData()) || {};
  data.installed_at = value;
  if ('new_user' in data) delete data.new_user;
  await plugin.saveData(data);
}

export function isNewUser(plugin: SmartConnectionsPlugin): boolean {
  return !plugin._installed_at;
}

export async function handleNewUser(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!isNewUser(plugin)) return;

  await saveInstalledAt(plugin, Date.now());
  await setLastKnownVersion(plugin, plugin.manifest.version);

  setTimeout(() => {
    ConnectionsView.open(plugin.app.workspace);
  }, 1000);

  if ((plugin.app.workspace as any).rightSplit?.collapsed) {
    (plugin.app.workspace as any).rightSplit?.toggle();
  }

  await addToGitignore(plugin, '\n\n# Ignore Smart Environment folder\n.smart-env');
}

export async function getLastKnownVersion(plugin: SmartConnectionsPlugin): Promise<string> {
  const data = (await plugin.loadData()) || {};
  return data.last_version || '';
}

export async function setLastKnownVersion(plugin: SmartConnectionsPlugin, version: string): Promise<void> {
  const data = (await plugin.loadData()) || {};
  data.last_version = version;
  await plugin.saveData(data);
}

export async function addToGitignore(plugin: SmartConnectionsPlugin, ignore: string, message: string | null = null): Promise<void> {
  if (!(await plugin.app.vault.adapter.exists('.gitignore'))) return;

  const gitignore = await plugin.app.vault.adapter.read('.gitignore');
  if (gitignore.indexOf(ignore) < 0) {
    await plugin.app.vault.adapter.append(
      '.gitignore',
      `\n\n${message ? '# ' + message + '\n' : ''}${ignore}`,
    );
  }
}
