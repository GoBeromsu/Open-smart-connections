import type SmartConnectionsPlugin from '../main';
import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from './ConnectionsView';
import { LookupView, LOOKUP_VIEW_TYPE } from './LookupView';
import { registerCommands } from './commands';
import { registerSmartConnectionsCodeBlock } from './plugin-codeblock';
import { SmartConnectionsSettingsTab } from './settings';

export function registerPluginUi(plugin: SmartConnectionsPlugin): void {
  const reader = plugin.connectionsReader;

  plugin.registerView(CONNECTIONS_VIEW_TYPE, (leaf) => new ConnectionsView(leaf, plugin, reader));
  plugin.registerView(LOOKUP_VIEW_TYPE, (leaf) => new LookupView(leaf, plugin));
  plugin.registerView('smart-connections-view', (leaf) => new ConnectionsView(leaf, plugin, reader));
  plugin.registerView('smart-connections-lookup', (leaf) => new LookupView(leaf, plugin));

  plugin.addSettingTab(new SmartConnectionsSettingsTab(plugin.app, plugin));
  registerCommands(plugin);
  registerSmartConnectionsCodeBlock(plugin);

  plugin.addRibbonIcon('network', 'Open connections', () => {
    void ConnectionsView.open(plugin.app.workspace);
  });
}
