/**
 * @file message_model_info.js
 * @description
 * Renders a small, dim “model info” line that shows the model +
 * provider that produced a completion.
 *
 * Example output (inherits .system styles):
 *   Model: gpt-4o (openai)
 */

export function build_html(completion, opts = {}) {
  const model_key = completion.data.completion?.chat_model?.model_key
    ?? completion.chat_model?.model_key
  ;
  const platform_key = completion.data.completion?.chat_model?.adapter_name
    ?? completion.data.completion?.chat_model?.platform_key // DEPRECATED: use adapter_name
    ?? completion.chat_model?.adapter_name
  ;

  return /* html */ `<div class="wrapper">
    <div class="model-info" data-model-key="${model_key}" data-platform-key="${platform_key}">
      <div class="smart-chat-message-content">
        Model: <code>${model_key}</code> (<code>${platform_key}</code>)
      </div>
    </div>
  </div>`;
}

export async function render(completion, opts = {}) {
  if(!should_show_model_info(completion)) return null;
  const html = build_html(completion, opts);
  const frag = this.create_doc_fragment(html);
  const container = frag.querySelector('.model-info');
  return container;
}

function should_show_model_info(completion) {
  const thread = completion.thread;
  if (!thread) return true; // orphan ⇒ always show

  const idx = thread.completions.findIndex(x => x.key === completion.key);
  if (idx === 0) return true; // first completion

  const prev = thread.last_completion;
  const cm_prev = prev?.data?.completion?.chat_model;
  const cm_curr = (completion === thread.current_completion) && completion.chat_model
    ? {
        model_key: completion.chat_model.model_key,
        platform_key: completion.chat_model.adapter_name,
      }
    : completion.data?.completion?.chat_model
  ;

  if (!cm_prev) return true;
  if (!cm_curr) return true;

  return (
    cm_prev.platform_key !== cm_curr.platform_key ||
    cm_prev.model_key !== cm_curr.model_key
  );
}