import { PluginSettingTab } from 'obsidian';
import settings_tab_css from './settings_tab.css' with { type: 'css' };
import { SmartChatView } from './smart_chat.obsidian.js';

/**
 * @class SmartChatSettingTab
 * @extends PluginSettingTab
 * @description
 * Obsidian Settings tab for "Smart Chat" plugin.
 * Renders settings using the plugin's `env.smart_view` instance
 * and the plugin's `settings_config` object, attaching the results
 * to the display container.
 */
export class SmartChatSettingTab extends PluginSettingTab {
  /**
   * @param {import('obsidian').App} app - The current Obsidian app instance
   * @param {import('./main.js').default} plugin - The main plugin object
   */
  constructor(app, plugin) {
    super(app, plugin);
    /** @type {import('./main.js').default} */
    this.plugin = plugin;
    // sets this.env
    this.plugin.env.create_env_getter(this);
    this.name = 'Smart Chat';
    this.id = 'smart-chat';
  }

  /**
   * Called by Obsidian to render the settings page.
   */
  display() {
    this.containerEl.empty();
    if (!this.env) {
      this.containerEl.createEl('p', {
        text: 'Smart Templates environment not yet initialized.'
      });
      return;
    }
    this.containerEl.createEl('div', {
      cls: 'smart-chat-settings-container',
    });
    this.containerEl.createEl('div', {
      cls: 'smart-chat-model-settings-container',
    });

    // env settings container
    this.containerEl.createEl('div', {
      cls: 'smart-chat-env-settings-container',
    });

    // this.render_settings();
    this.env.render_component('chat_thread_settings', this.env).then(frag => {
      const settings_container = this.containerEl.querySelector('.smart-chat-settings-container');
      settings_container.empty();
      // add header
      settings_container.createEl('h3', {
        text: 'Chat',
      });
      settings_container.appendChild(frag);
    });
  
    this.env.render_component('chat_model_settings', this.env).then(frag => {
      const model_settings_container = this.containerEl.querySelector('.smart-chat-model-settings-container');
      model_settings_container.empty();
      // add header
      model_settings_container.createEl('h3', {
        text: 'Model',
      });
      model_settings_container.appendChild(frag);

      // add listener to data-name="Chat Model" dropdown
      const chat_model_dropdown = model_settings_container.querySelector('[data-name="Chat Model"] select');
      chat_model_dropdown.addEventListener('change', e => {
        SmartChatView.open(this.plugin);
      });
    });
    this.env.smart_view.apply_style_sheet(settings_tab_css);

    // env settings container
    this.env.render_component('env_settings', this.env).then(frag => {
      const settings_container = this.containerEl.querySelector('.smart-chat-env-settings-container');
      settings_container.empty();
      settings_container.appendChild(frag);
    });

  }
}
