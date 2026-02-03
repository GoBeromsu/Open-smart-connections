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
  if(opts.settings_container){
    this.empty(opts.settings_container);
    opts.settings_container.appendChild(frag.querySelector('.collection-settings'));
  }else{
    collection.settings_container = frag.querySelector('.collection-settings-container');
  }
  // post_process.call(this, collection, collection.settings_container, opts);
  return collection.settings_container;
}

export async function post_process(collection, container, opts = {}) {
}

