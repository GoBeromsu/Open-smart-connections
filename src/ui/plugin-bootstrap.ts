import type SmartConnectionsPlugin from '../main';
import { beginLifecycle, isCurrentLifecycle, resetTransientRuntimeState } from './plugin-lifecycle';
import { registerPluginUi } from './plugin-registration';

export async function onPluginLoad(plugin: SmartConnectionsPlugin): Promise<void> {
  plugin._unloading = false;
  const lifecycle = beginLifecycle(plugin);
  resetTransientRuntimeState(plugin);
  plugin.logger.debug('Loading Open Connections plugin');

  await plugin.loadSettings();
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  if (plugin.app.workspace.layoutReady) {
    await plugin.initialize(lifecycle);
  } else {
    plugin.app.workspace.onLayoutReady(async () => {
      if (!isCurrentLifecycle(plugin, lifecycle)) return;
      await plugin.initialize(lifecycle);
    });
  }

  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  registerPluginUi(plugin);
}
