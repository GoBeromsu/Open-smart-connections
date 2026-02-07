import { Notice, Plugin, requestUrl, Platform, TFile, TFolder, TAbstractFile, arrayBufferToBase64 } from "obsidian";

import { SmartEnv } from 'obsidian-smart-env';
import { smart_env_config } from "./smart_env.config.js";
import { smart_env_config as built_smart_env_config } from "../smart_env.config.js";
import { smart_env_config as obsidian_smart_env_config } from 'obsidian-smart-env/smart_env.config.js';

import { ConnectionsView, CONNECTIONS_VIEW_TYPE } from "./views/connections_view.js";
import { OscSettingsTab } from "./settings_tab.ts";
import { open_note } from "obsidian-smart-env/utils/open_note.js";
import { merge_env_config } from "obsidian-smart-env";
import { add_smart_dice_icon } from "./utils/add_icons.js";
import { determine_installed_at } from "./utils/determine_installed_at.js";

export default class SmartConnectionsPlugin extends Plugin {

  get obsidian() {
    return { Notice, Plugin, requestUrl, Platform, TFile, TFolder, TAbstractFile, arrayBufferToBase64 };
  }

  get smart_env_config() {
    if (!this._smart_env_config) {
      const merged_env_config = merge_env_config(built_smart_env_config, smart_env_config);
      merge_env_config(merged_env_config, obsidian_smart_env_config);
      this._smart_env_config = {
        ...merged_env_config,
        env_path: '',
        smart_env_settings: {
          is_obsidian_vault: true,
        },
        request_adapter: requestUrl,
      };
      if (Platform.isMobile) {
        merge_env_config(this._smart_env_config, {
          collections: {
            smart_sources: { prevent_load_on_init: true },
          },
        });
      }
    }
    return this._smart_env_config;
  }

  get settings() { return this.env?.settings || {}; }

  onload() {
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
    SmartEnv.create(this);

    // Register connections view
    this.registerView(
      CONNECTIONS_VIEW_TYPE,
      (leaf) => new ConnectionsView(leaf, this)
    );

    // Settings tab
    this.addSettingTab(new OscSettingsTab(this.app, this));

    // Commands
    this.addCommand({
      id: 'open-connections-view',
      name: 'Open: Connections view',
      callback: () => ConnectionsView.open(this.app.workspace),
    });

    // Ribbon icon
    add_smart_dice_icon();
    this.addRibbonIcon('network', 'Open Connections', () => {
      ConnectionsView.open(this.app.workspace);
    });
  }

  onunload() {
    this.env?.unload_main?.(this);
  }

  async initialize() {
    await this.load_new_user_state();
    await SmartEnv.wait_for({ loaded: true });
    await this.migrate_last_version_from_localStorage();
    await this.check_for_updates();
    this.new_user();
  }

  async new_user() {
    if (!this.is_new_user()) return;
    await this.save_installed_at(Date.now());
    await this.set_last_known_version(this.manifest.version);
    setTimeout(() => {
      ConnectionsView.open(this.app.workspace);
    }, 1000);
    if (this.app.workspace.rightSplit.collapsed) this.app.workspace.rightSplit.toggle();
    this.add_to_gitignore("\n\n# Ignore Smart Environment folder\n.smart-env");
  }

  async open_note(target_path, event = null) {
    await open_note(this, target_path, event);
  }

  // ─── Update check ───
  async check_for_updates() {
    if (await this.should_show_release_notes(this.manifest.version)) {
      await this.set_last_known_version(this.manifest.version);
    }
    setTimeout(this.check_for_update.bind(this), 3000);
    setInterval(this.check_for_update.bind(this), 10800000);
  }

  async check_for_update() {
    try {
      const { json: response } = await requestUrl({
        url: "https://api.github.com/repos/GoBeromsu/obsidian-smart-connections/releases/latest",
        method: "GET",
        headers: { "Content-Type": "application/json" },
        contentType: "application/json",
      });
      if (response.tag_name !== this.manifest.version) {
        new Notice(`Smart Connections: Update available (${response.tag_name})`);
      }
    } catch (error) {
      // Silent failure
    }
  }

  // ─── User state persistence ───
  async load_new_user_state() {
    this._installed_at = null;
    const data = await this.loadData();
    if (this.migrate_installed_at_from_localStorage()) return;
    if (data && typeof data.installed_at !== 'undefined') {
      this._installed_at = data.installed_at;
    }
    const data_ctime = await this.get_data_json_created_at();
    const resolved = determine_installed_at(this._installed_at, data_ctime);
    if (resolved !== this._installed_at) {
      await this.save_installed_at(resolved);
    }
  }

  async get_data_json_created_at() {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
      const stat = await this.app.vault.adapter.stat(path);
      return stat?.ctime ?? null;
    } catch (error) {
      return null;
    }
  }

  migrate_installed_at_from_localStorage() {
    const key = 'smart_connections_new_user';
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null) {
      const oldValue = localStorage.getItem(key) !== 'false';
      if (!oldValue) {
        this._installed_at = Date.now();
        this.save_installed_at(this._installed_at);
      }
      localStorage.removeItem(key);
      return true;
    }
    return false;
  }

  async save_installed_at(value) {
    this._installed_at = value;
    const data = (await this.loadData()) || {};
    data.installed_at = value;
    if ('new_user' in data) delete data.new_user;
    await this.saveData(data);
  }

  is_new_user() { return !this._installed_at; }

  async migrate_last_version_from_localStorage() {
    const key = 'smart_connections_last_version';
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) {
      await this.set_last_known_version(localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  }

  async get_last_known_version() {
    const data = (await this.loadData()) || {};
    return data.last_version || '';
  }

  async set_last_known_version(version) {
    const data = (await this.loadData()) || {};
    data.last_version = version;
    await this.saveData(data);
  }

  async should_show_release_notes(current_version) {
    return (await this.get_last_known_version()) !== current_version;
  }

  async add_to_gitignore(ignore, message = null) {
    if (!(await this.app.vault.adapter.exists(".gitignore"))) return;
    let gitignore_file = await this.app.vault.adapter.read(".gitignore");
    if (gitignore_file.indexOf(ignore) < 0) {
      await this.app.vault.adapter.append(".gitignore", `\n\n${message ? "# " + message + "\n" : ""}${ignore}`);
    }
  }

  async restart_plugin() {
    this.env?.unload_main?.(this);
    await new Promise(r => setTimeout(r, 3000));
    await window.app.plugins.disablePlugin(this.manifest.id);
    await window.app.plugins.enablePlugin(this.manifest.id);
  }
}
