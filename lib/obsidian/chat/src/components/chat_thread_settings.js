export async function render (env, opts = {}) {
  return await this.render_settings(env.smart_chat_threads.settings_config, {
    scope: env.smart_chat_threads,
  });
}
