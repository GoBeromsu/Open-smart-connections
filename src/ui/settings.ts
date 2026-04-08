/**
 * @file settings.ts
 * @description Settings tab composition for Open Connections.
 */

import {
  App,
  EventRef,
  PluginSettingTab,
  Setting,
} from 'obsidian';

import { renderBlockSettings, renderNoticeSettings, renderSourceSettings, renderViewSettings } from './settings-basic-sections';
import { createSettingsConfigAccessor } from './settings-config-accessor';
import { confirmWithModal } from './settings-confirm-modal';
import { renderEmbeddingModelSection } from './settings-embedding-model-section';
import { renderEmbeddingStatus, updateEmbeddingStatusOnly } from './settings-status-section';
import { parseMcpSettings } from '../mcp/settings';
import type { EmbeddingStatusElements, SmartConnectionsPlugin } from './settings-types';

export class SmartConnectionsSettingsTab extends PluginSettingTab {
  plugin: SmartConnectionsPlugin;
  private eventRefs: EventRef[] = [];
  private statusElements: EmbeddingStatusElements | null = null;
  private statusRowEl: HTMLElement | null = null;
  private statsGridEl: HTMLElement | null = null;
  private currentRunEl: HTMLElement | null = null;
  private currentRunSettingEl: HTMLElement | null = null;
  private embedProgress: EmbeddingStatusElements['embedProgress'] = null;

  constructor(app: App, plugin: SmartConnectionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private cleanupListeners(): void {
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs = [];
    this.statusElements?.embedProgress?.destroy();
    this.statusElements = null;
    this.statusRowEl = null;
    this.statsGridEl = null;
    this.currentRunEl = null;
    this.currentRunSettingEl = null;
    this.embedProgress = null;
  }

  hide(): void {
    this.cleanupListeners();
  }

  display(): void {
    this.cleanupListeners();

    const { containerEl } = this;
    if (!this.plugin.settings) {
      containerEl.empty();
      return;
    }
    const config = createSettingsConfigAccessor(this.app, this.plugin);
    containerEl.empty();
    containerEl.addClass('open-connections-settings');

    new Setting(containerEl).setName('Embedding model').setHeading();
    renderEmbeddingModelSection(
      containerEl,
      this.plugin,
      config,
      (message) => this.confirmReembed(message),
      () => this.triggerReEmbed(),
      () => this.display(),
    );

    new Setting(containerEl).setName('Sources').setHeading();
    renderSourceSettings(containerEl, config);

    new Setting(containerEl).setName('Blocks').setHeading();
    renderBlockSettings(containerEl, config);

    new Setting(containerEl).setName('View').setHeading();
    renderViewSettings(containerEl, config);

    new Setting(containerEl).setName('Notices').setHeading();
    renderNoticeSettings(containerEl, this.plugin, () => this.display());

    const existingMcpSettings = this.plugin.settings?.mcp;
    const mcpSettings = parseMcpSettings(existingMcpSettings);
    if (this.plugin.settings) {
      this.plugin.settings.mcp = mcpSettings;
    }
    new Setting(containerEl).setName('MCP').setHeading();
    new Setting(containerEl)
      .setName('Enable local server')
      .setDesc('Expose the current vault through a local endpoint at http://127.0.0.1:<port>/mcp')
      .addToggle((toggle) => {
        toggle.setValue(Boolean(mcpSettings.enabled));
        toggle.onChange(async (value) => {
          mcpSettings.enabled = value;
          await this.plugin.saveSettings?.();
          try {
            await this.plugin.syncMcpServer?.();
          } catch (error) {
            this.plugin.notices?.show?.('mcp_server_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          this.display();
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
          await this.plugin.saveSettings?.();
          if (mcpSettings.enabled) {
            try {
              await this.plugin.syncMcpServer?.();
            } catch (error) {
              this.plugin.notices?.show?.('mcp_server_failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          this.display();
        });
      });

    const mcpServer = this.plugin.getMcpServer?.();
    new Setting(containerEl)
      .setName('Local server status')
      .setDesc(mcpServer?.isRunning ? mcpServer.endpointUrl : 'Server stopped')
      .addButton((button) => {
        button
          .setButtonText(mcpServer?.isRunning ? 'Restart' : 'Start')
          .onClick(async () => {
            mcpSettings.enabled = true;
            await this.plugin.saveSettings?.();
            try {
              await this.plugin.syncMcpServer?.();
            } catch (error) {
              this.plugin.notices?.show?.('mcp_server_failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText('Stop')
          .setDisabled(!mcpServer?.isRunning)
          .onClick(async () => {
            mcpSettings.enabled = false;
            await this.plugin.saveSettings?.();
            try {
              await this.plugin.syncMcpServer?.();
            } catch (error) {
              this.plugin.notices?.show?.('mcp_server_failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
            this.display();
          });
      });

    new Setting(containerEl).setName('Embedding status').setHeading();
    this.statusElements = renderEmbeddingStatus(containerEl, this.plugin);
    this.statusRowEl = this.statusElements.statusRowEl;
    this.statsGridEl = this.statusElements.statsGridEl;
    this.currentRunEl = this.statusElements.currentRunEl;
    this.currentRunSettingEl = this.statusElements.currentRunSettingEl;
    this.embedProgress = this.statusElements.embedProgress;

    new Setting(containerEl)
      .setName('Actions')
      .setDesc('Control the embedding pipeline.')
      .addButton((button) => {
        button.setButtonText('Re-embed stale').onClick(async () => {
          const count = await this.plugin.reembedStaleEntities?.('Settings re-embed');
          if (count === 0) {
            this.plugin.notices?.show?.('no_stale_entities');
          }
          this.display();
        });
      });

    this.eventRefs.push(
      this.app.workspace.on('open-connections:embed-progress', () => this.updateEmbeddingStatusOnly()),
    );
    this.eventRefs.push(
      this.app.workspace.on('open-connections:embed-state-changed', () => this.updateEmbeddingStatusOnly()),
    );
  }

  updateEmbeddingStatusOnly(): void {
    if (!this.statusElements) return;
    updateEmbeddingStatusOnly(this.plugin, this.statusElements);
  }

  private async confirmReembed(message: string): Promise<boolean> {
    return confirmWithModal(this.app, message);
  }

  private async triggerReEmbed(): Promise<void> {
    this.plugin.notices?.show?.('reinitializing_embedding_model');
    try {
      await this.plugin.switchEmbeddingModel?.('Settings model switch');
      this.plugin.notices?.show?.('embedding_model_switched');
      this.display();
    } catch {
      this.plugin.notices?.show?.('failed_reinitialize_model');
    }
  }

  private getConfig<T>(path: string, fallback: T): T {
    return createSettingsConfigAccessor(this.app, this.plugin).getConfig(path, fallback);
  }

  private setConfig(path: string, value: unknown): void {
    createSettingsConfigAccessor(this.app, this.plugin).setConfig(path, value);
  }
}
