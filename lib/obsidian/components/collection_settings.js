import { format_collection_name } from "../utils/format_collection_name.js";
export async function build_html(collection, opts={}){
  const settings_html = Object.entries(collection.settings_config).map(([setting_key, setting_config]) => {
    if (!setting_config.setting) setting_config.setting = setting_key;
    return this.render_setting_html(setting_config);
  }).join('\n');
  const html = `<div><div class="collection-settings-container"><div class="source-settings collection-settings">
    <h2>${format_collection_name(collection.collection_key)}</h2>
    ${settings_html}
  </div></div></div>`;
  return html;
}

export async function render(collection, opts = {}) {
  const html = await build_html.call(this, collection, opts);
  const frag = this.create_doc_fragment(html);
  await this.render_setting_components(frag, {scope: collection});

  try {
    if (collection.embed_model) {
      const embed_model_settings = await collection.env.render_component('settings', collection.embed_model, opts);
      frag.querySelector('.collection-settings').appendChild(embed_model_settings);
    }
  } catch (e) {
    console.warn('Failed to render embed_model settings:', e);
  }

  if(opts.settings_container){
    this.empty(opts.settings_container);
    opts.settings_container.appendChild(frag.querySelector('.collection-settings'));
  }else{
    collection.settings_container = frag.querySelector('.collection-settings-container');
  }
  return collection.settings_container;
}
