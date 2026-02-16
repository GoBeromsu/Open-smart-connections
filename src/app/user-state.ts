/**
 * @file user-state.ts
 * @description User state management: install tracking, update checks, gitignore helpers
 */

import { requestUrl } from 'obsidian';
import type SmartConnectionsPlugin from './main';
import { ConnectionsView } from '../features/connections/ConnectionsView';
import { determine_installed_at } from './utils/determine_installed_at';

/** 3 hours in milliseconds — interval between automatic update checks */
const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

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
  if (typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null) {
    const oldValue = localStorage.getItem(key) !== 'false';
    if (!oldValue) {
      plugin._installed_at = Date.now();
      saveInstalledAt(plugin, plugin._installed_at);
    }
    localStorage.removeItem(key);
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

export async function checkForUpdates(plugin: SmartConnectionsPlugin): Promise<void> {
  if (await shouldShowReleaseNotes(plugin, plugin.manifest.version)) {
    await setLastKnownVersion(plugin, plugin.manifest.version);
  }

  setTimeout(() => checkForUpdate(plugin), 3000);
  setInterval(() => checkForUpdate(plugin), UPDATE_CHECK_INTERVAL_MS);
}

export async function checkForUpdate(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const { json: response } = await requestUrl({
      url: 'https://api.github.com/repos/GoBeromsu/obsidian-smart-connections/releases/latest',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      contentType: 'application/json',
    });

    if (response.tag_name !== plugin.manifest.version) {
      plugin.notices.show('update_available', { tag_name: response.tag_name });
    }
  } catch {
    // Silent failure
  }
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

export async function shouldShowReleaseNotes(plugin: SmartConnectionsPlugin, currentVersion: string): Promise<boolean> {
  return (await getLastKnownVersion(plugin)) !== currentVersion;
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
