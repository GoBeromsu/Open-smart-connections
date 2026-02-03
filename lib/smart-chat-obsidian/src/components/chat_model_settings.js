export async function render (env, opts = {}) {
  const smart_chat_model_settings_config = env.smart_chat_threads?.chat_model?.settings_config; 
  return await this.render_settings(smart_chat_model_settings_config, {
    scope: env.smart_chat_threads?.chat_model,
  });
}
