import { ItemView } from "obsidian";
import { wait_for_env_to_load } from "obsidian-smart-env/utils/wait_for_env_to_load.js";

/**
 * @class SmartChatView
 * @extends ItemView
 * @description Main Smart Chat view for Obsidian workspace.
 */
export class SmartChatView extends ItemView {
  /**
   * @param {WorkspaceLeaf} leaf
   * @param {Plugin} plugin
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.plugin.env.create_env_getter(this);
  }
  static last_plugin = null;

  static view_type = "smart-chat-view";
  /**
   * Unique identifier for the view type.
   * @returns {string}
   */
  getViewType() {
    return this.constructor.view_type;
  }

  static view_name = "Smart Chat";
  /**
   * Display text for the workspace tab.
   * @returns {string}
   */
  getDisplayText() {
    return this.constructor.view_name;
  }

  static icon = "smart-chat";
  /**
   * Icon for the view.
   * @returns {string}
   */
  getIcon() {
    return this.constructor.icon;
  }

  /**
   * Called by Obsidian when the view is opened.
   */
  onOpen() {
    this.render();
  }

  get container() { return this.containerEl.children[1]; }
  /**
   * Render the chat component into the view.
   */
  async render() {
    await wait_for_env_to_load(this);
    this.containerEl.empty();
    const container = await this.env.render_component("chat", this.env.smart_chat_threads, {});
    this.containerEl.appendChild(container);
  }

  static open(plugin = this.last_plugin) {
    const existing = plugin.app.workspace.getLeavesOfType(this.view_type)[0];
    if (existing) {
      existing.setViewState({ type: this.view_type, active: true });
      existing.view?.render();
      return;
    }

    const root_leaf = plugin.app.workspace.getLeaf(true);
    root_leaf.setViewState({ type: this.view_type, active: true });
  }


  /**
   * Registers the Smart Chat view with the plugin.
   * @param {import('obsidian').Plugin} plugin - Obsidian plugin instance.
   */
  static register_view(plugin) {
    if(
      plugin.app.plugins.enabledPlugins.has('smart-chat')
      && plugin.manifest.id !== 'smart-chat'
    ) return console.log(`Skipping Smart Chat registration for plugin ${plugin.manifest.id} since dedicated Smart Chat plugin is enabled.`);
    this.last_plugin = plugin;
    plugin.registerView(this.view_type, (leaf) => new this(leaf, plugin));
    plugin.addRibbonIcon(this.icon, "Open: " + this.view_name, () => {
      this.open(plugin);
    });
    plugin.addCommand({
      id: "open-" + this.view_type,
      name: "Open " + this.view_name,
      callback: () => this.open(plugin),
    });
  }
}
