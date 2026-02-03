import { Plugin, Notice, addIcon } from "obsidian";
import { SmartEnv } from "obsidian-smart-env";
import { merge_env_config } from "obsidian-smart-env";
import { smart_env_config as smart_context_env_config } from "smart-context-obsidian/smart_env.config.js";

import { smart_env_config } from "./smart_env.config.js";

import {SmartChatView} from "./src/smart_chat.obsidian.js";
import { SmartChatSettingTab } from "./src/settings_tab.js";
import { register_smart_chat_codeblock } from './src/codeblocks/register.js';

export default class SmartChatPlugin extends Plugin {
  compiled_smart_env_config = smart_env_config;

  onload() {
    const merged_config = merge_env_config(this.compiled_smart_env_config, smart_context_env_config);
    SmartEnv.create(this, merged_config);
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }

  async initialize() {
    console.log("Loading Smart Chat plugin...");
    await SmartEnv.wait_for({ loaded: true });
    SmartChatView.register_view(this);
    this.addSettingTab(new SmartChatSettingTab(this.app, this));
    register_smart_chat_codeblock(this);
  }

  onunload() {
    console.log("Unloading Smart Chat plugin...");
    this.env?.unload_main?.(this);
  }


}

export {SmartChatPlugin};