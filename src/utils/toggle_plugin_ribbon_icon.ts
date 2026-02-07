import { SmartEnv } from 'obsidian-smart-env';

export async function toggle_plugin_ribbon_icon(
  plugin: any,
  icon_name: string,
  show_icon?: boolean,
): Promise<void> {
  const icon = plugin.ribbon_icons[icon_name];
  icon.elm = plugin.addRibbonIcon(icon.icon_name, icon.description, icon.callback);
  const ribbon_icon_id = plugin.manifest.id + ':' + icon.description;
  const ribbon_item = plugin.app.workspace.leftRibbon.items.find(
    (item: any) => item.id === ribbon_icon_id,
  );
  await SmartEnv.wait_for({ loaded: true });
  if (!plugin.env.settings.ribbon_icons) plugin.env.settings.ribbon_icons = {};
  if (typeof show_icon === 'undefined') {
    if (ribbon_item.hidden) {
      plugin.env.settings.ribbon_icons[icon_name] = false;
    }
    show_icon = plugin.env.settings.ribbon_icons[icon_name];
  } else {
    plugin.env.settings.ribbon_icons[icon_name] = show_icon;
  }
  ribbon_item.hidden = !show_icon;
  plugin.app.workspace.leftRibbon.load(plugin.app.workspace.leftRibbon.ribbonItemsEl);
  plugin.app.workspace.saveLayout();
}
