import type { SettingsConfigEntry } from '../types';

interface SettingsScope {
  settings_config: Record<string, SettingsConfigEntry & { setting?: string }>;
}

interface RenderContext {
  render_setting_html(config: SettingsConfigEntry & { setting?: string }): string;
  create_doc_fragment(html: string): DocumentFragment;
  render_setting_components(frag: DocumentFragment, opts: { scope: SettingsScope }): Promise<void>;
}

export async function render(this: RenderContext, scope: SettingsScope, opts: Record<string, any> = {}): Promise<DocumentFragment> {
  const html = Object.entries(scope.settings_config).map(([setting_key, setting_config]) => {
    if (!setting_config.setting) setting_config.setting = setting_key;
    return this.render_setting_html(setting_config);
  }).join('\n');
  const frag = this.create_doc_fragment(html);
  return await post_process.call(this, scope, frag, opts);
}

export async function post_process(this: RenderContext, scope: SettingsScope, frag: DocumentFragment, opts: Record<string, any> = {}): Promise<DocumentFragment> {
  await this.render_setting_components(frag, {scope});
  return frag;
}
