import type SmartConnectionsPlugin from '../main';
import { TFile } from 'obsidian';

export async function openNote(
  plugin: SmartConnectionsPlugin,
  targetPath: string,
  event: MouseEvent | null = null,
): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(targetPath);
  if (!(file instanceof TFile)) return;
  const mode = event?.ctrlKey || event?.metaKey ? 'tab' : 'source';
  await plugin.app.workspace.getLeaf(mode === 'tab').openFile(file);
}
