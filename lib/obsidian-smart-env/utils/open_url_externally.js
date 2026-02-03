/**
 * Opens a URL externally, using the Obsidian webviewer plugin if possible,
 * otherwise falling back to window.open().
 *
 * @param {string} url
 */
export function open_url_externally(plugin, url) {
  const webviewer = plugin.app.internalPlugins?.plugins?.webviewer?.instance;
  window.open(url, webviewer ? '_external' : '_blank');
}