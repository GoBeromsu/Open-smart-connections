import { Setting } from 'obsidian';

import { parseMcpSettings } from '../mcp/settings';
import type { SmartConnectionsPlugin } from './settings-types';

export function renderMcpSettingsSection(
  containerEl: HTMLElement,
  plugin: SmartConnectionsPlugin,
  display: () => void,
): void {
  const existingMcpSettings = plugin.settings?.mcp;
  const mcpSettings = parseMcpSettings(existingMcpSettings);
  if (plugin.settings) {
    plugin.settings.mcp = mcpSettings;
  }

  new Setting(containerEl).setName('MCP').setHeading();
  new Setting(containerEl)
    .setName('Enable local server')
    .setDesc('Expose the current vault through a local endpoint at http://127.0.0.1:<port>/mcp')
    .addToggle((toggle) => {
      toggle.setValue(Boolean(mcpSettings.enabled));
      toggle.onChange(async (value) => {
        mcpSettings.enabled = value;
        await plugin.saveSettings?.();
        try {
          await plugin.syncMcpServer?.();
        } catch (error) {
          plugin.notices?.show?.('mcp_server_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        display();
      });
    });

  new Setting(containerEl)
    .setName('Local server port')
    .setDesc('Localhost port for the local endpoint.')
    .addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(String(mcpSettings.port));
      text.onChange(async (value) => {
        const port = parseMcpSettings({ ...mcpSettings, port: value }).port;
        mcpSettings.port = port;
        await plugin.saveSettings?.();
        if (mcpSettings.enabled) {
          try {
            await plugin.syncMcpServer?.();
          } catch (error) {
            plugin.notices?.show?.('mcp_server_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        display();
      });
    });

  const mcpServer = plugin.getMcpServer?.();
  new Setting(containerEl)
    .setName('Local server status')
    .setDesc(mcpServer?.isRunning ? mcpServer.endpointUrl : 'Server stopped')
    .addButton((button) => {
      button
        .setButtonText(mcpServer?.isRunning ? 'Restart' : 'Start')
        .onClick(async () => {
          mcpSettings.enabled = true;
          await plugin.saveSettings?.();
          try {
            await plugin.syncMcpServer?.();
          } catch (error) {
            plugin.notices?.show?.('mcp_server_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          display();
        });
    })
    .addButton((button) => {
      button
        .setButtonText('Stop')
        .setDisabled(!mcpServer?.isRunning)
        .onClick(async () => {
          mcpSettings.enabled = false;
          await plugin.saveSettings?.();
          try {
            await plugin.syncMcpServer?.();
          } catch (error) {
            plugin.notices?.show?.('mcp_server_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          display();
        });
    });
}
