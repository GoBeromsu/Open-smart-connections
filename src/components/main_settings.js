import { toggle_plugin_ribbon_icon } from "../utils/toggle_plugin_ribbon_icon.js";

async function build_html(scope_plugin) {
  return `
    <div id="smart-connections-settings">
      <div data-user-agreement></div>

      <div data-connections-settings-container>
        <h2>Connections view</h2>
      </div>

      <div data-ribbon-icons-settings>
        <h2>Ribbon icons</h2>
      </div>

      <div data-smart-settings="env"></div>
    </div>
  `;
}

export async function render(scope_plugin) {
  if (!scope_plugin.env) {
    const load_frag = this.create_doc_fragment(`
      <div><button>Load Smart Environment</button></div>
    `);
    load_frag.querySelector('button').addEventListener('click', (e) => {
      scope_plugin.env.load(true);
      e.target.replaceWith(
        this.create_doc_fragment('<span>Reload settings after Smart Environment loads…</span>')
      );
    });
    return load_frag;
  }
  const html = await build_html.call(this, scope_plugin);
  const frag = this.create_doc_fragment(html);
  return await post_process.call(this, scope_plugin, frag);
}

export async function post_process(scope_plugin, frag) {
  /* user agreement & env settings */
  const user_agreement_container = frag.querySelector('[data-user-agreement]');
  if (user_agreement_container) {
    const user_agreement = await scope_plugin.env.render_component(
      'user_agreement_callout',
      scope_plugin
    );
    user_agreement_container.appendChild(user_agreement);
  }

  const env_settings_container = frag.querySelector('[data-smart-settings="env"]');
  if (env_settings_container) {
    const env_settings_frag = await scope_plugin.env.render_component(
      'env_settings',
      scope_plugin.env
    );
    env_settings_container.appendChild(env_settings_frag);
  }

  /* connections‑view settings */
  const connections_settings = frag.querySelector('[data-connections-settings-container]');
  if (connections_settings) {
    const connections_settings_frag = await this.render_settings(
      scope_plugin.env.smart_sources.connections_filter_config,
      { scope: { settings: scope_plugin.env.settings } }
    );
    connections_settings.appendChild(connections_settings_frag);
  }

  /* ribbon icon settings */
  const ribbon_container = frag.querySelector('[data-ribbon-icons-settings]');
  if (ribbon_container) {
    if (!scope_plugin.env.settings.ribbon_icons) scope_plugin.env.settings.ribbon_icons = {};
    const ribbon_frag = await this.render_settings(
      {
        connections: {
          setting: 'connections',
          name: 'Open connections view',
          description: 'Show the &quot;Open connections view&quot; icon.',
          type: 'toggle',
          callback: 'toggle_plugin_ribbon_icon',
        },
        random_note: {
          setting: 'random_note',
          name: 'Open random connection',
          description: 'Show the &quot;Open random connection&quot; icon.',
          type: 'toggle',
          callback: 'toggle_plugin_ribbon_icon',
        },
      },
      {
        scope: {
          settings: scope_plugin.env.settings.ribbon_icons,
          toggle_plugin_ribbon_icon: (setting_path, value) => {
            toggle_plugin_ribbon_icon(scope_plugin, setting_path, value);
          },
        } 
      }
    );
    ribbon_container.appendChild(ribbon_frag);
  }

  return frag;
}
