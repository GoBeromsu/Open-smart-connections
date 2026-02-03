import completion_css from './completion.css' with { type: 'css' };

/**
 * @function build_html
 * @description Returns a container with no direct content - subcomponents will be appended.
 * @param {Object} completion
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(completion, opts = {}) {
  return `<div>
    <div class="smart-chat-completion-sequence" data-completion-key="${completion.key}">
    </div>
  </div>`;
}

/**
 * @function render
 * @description Renders the completion container, then calls post_process.
 * @param {Object} completion
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(completion, opts = {}) {
  if (!completion.container) {
    const html = await build_html.call(this, completion, opts);
    const frag = this.create_doc_fragment(html);
    completion.container = frag.querySelector('.smart-chat-completion-sequence');
    this.apply_style_sheet(completion_css);
  }
  post_process.call(this, completion, completion.container, opts);
  return completion.container;
}

/**
 * @function post_process
 * @description Renders (appends) user message, context review, assistant message in order.
 * Also handles streaming updates in chunk and done callbacks.
 * @param {Object} completion
 * @param {HTMLElement} sequence_container
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function post_process(completion, sequence_container, opts = {}) {
  // Possibly render system, user, action blocks if not present
  if (!completion.system_elm && completion.data.system_message) {
    completion.system_elm = true;
    completion.system_elm = await completion.env.render_component('message_system', completion);
    completion.container.appendChild(completion.system_elm);
  }
  const model_info_container = await completion.env.render_component('message_model_info', completion);
  if(model_info_container){
    if(completion.model_info_elm){
      completion.model_info_elm.replaceWith(model_info_container);
    }else{
      completion.container.appendChild(model_info_container);
    }
  }
  completion.model_info_elm = model_info_container;
  if (!completion.user_elm && completion.data.user_message) {
    completion.user_elm = await completion.env.render_component('message_user', completion);
    completion.container.appendChild(completion.user_elm);
    if(!completion.response) scroll();
  }
  if (!completion.action_elm && completion.data.action_key) {
    const action_frag = await completion.env.render_component('message_action', completion);
    completion.action_elm = action_frag.querySelector('.smart-chat-message.action');
    completion.container.appendChild(completion.action_elm);
  }

  // Handle streaming if needed
  if ((opts.should_complete || completion.data.user_message) && completion.data.completion.responses.length === 0) {
    const typing_indicator = completion.container
      .closest('.smart-chat-thread')
      ?.querySelector('.smart-chat-typing-indicator');
    if (typing_indicator) typing_indicator.style.display = 'block';

    scroll();
    await completion.init({
      stream: completion.env.smart_chat_threads.settings.stream,
      stream_handlers: {
        chunk: async (c) => {
          while (this.handling_chunk) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          this.handling_chunk = true;
          if (!c.response_elm && c.response_text) {
            c.response_elm = await c.env.render_component('message_assistant', c, { await_post_process: true });
            c.content_elm = c.response_elm.querySelector('.smart-chat-message-content');
            completion.container.appendChild(c.response_elm);
          }
          else if (c.response_text && c.content_elm) {
            this.empty(c.content_elm);
            const partialFrag = await c.env.render_component('message_assistant', c, { await_post_process: true });
            const partialMessage = partialFrag.querySelector('.smart-chat-message-content');
            if (partialMessage) {
              c.content_elm.append(...partialMessage.childNodes);
            }
          }
          // update action_elm if present
          await update_action_message.call(this, c);
          this.handling_chunk = false;
        },
        done: async (c) => {
          while (this.handling_chunk) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          this.handling_chunk = true;
          if (c.response_elm && c.content_elm) {
            this.empty(c.content_elm);
            const finalFrag = await c.env.render_component('message_assistant', c, { await_post_process: true });
            const finalMessage = finalFrag.querySelector('.smart-chat-message-content');
            if (finalMessage) {
              c.content_elm.append(...finalMessage.childNodes);
            }
          }
          await update_action_message.call(this, c);
          this.handling_chunk = false;
        },
        error: (err) => {
          console.error('stream error', err);
          this.handling_chunk = false;
        }
      }
    });
    completion.thread.queue_save();
    completion.queue_save();
    completion.thread.collection.process_save_queue();
    completion.collection.process_save_queue();
    completion.container.style.marginBottom = '';
  }

  const is_tool_call_only = Boolean(completion.data.action_key);
  if (!is_tool_call_only && !completion.context_elm && (!completion.response || completion.data.completion.used_context)) {
    await render_context_container();
  }

  // If not streaming or done streaming, we may need the final assistant bubble
  if (!completion.response_elm && completion.response_text) {
    completion.response_elm = await completion.env.render_component('message_assistant', completion);
    completion.container.appendChild(completion.response_elm);
  }
  await update_action_message.call(this, completion);

  // Tool call scenario (e.g. "lookup_context")
  if (completion.data.actions?.lookup_context) {
    const typing_indicator = completion.container
      .closest('.smart-chat-thread')
      ?.querySelector('.smart-chat-typing-indicator');
    if (typing_indicator) typing_indicator.style.display = 'none';
  }
  if(completion.thread?.last_completion?.key === completion.key) {
    const next_completion = completion.thread.current_completion;
    completion.env.render_component('completion', next_completion).then((next_container) => {
      completion.thread.message_container.appendChild(next_container);
    });
  }
  
  async function render_context_container() {
    // TODO: move context retrieval logic to ensure_chat_ctx()
    let context;
    context = completion.env.smart_contexts.get(completion.data.context_key || '');
    if(!context && completion.thread) {
      const last_context_key = completion.thread.last_completion?.data?.context_key || '';
      context = completion.env.smart_contexts.get(last_context_key);
    }
    if(!context) {
      context = completion.env.smart_contexts.new_context();
    }
    completion.data.context_key = context.key;
    if (context) {
      const context_container = await completion.env.render_component(
        'chat_context_builder',
        context,
        { completion }
      );
      completion.context_elm = context_container;
      completion.container.querySelector('.sc-context-builder')?.remove();
      completion.container.appendChild(completion.context_elm);
      context_container.addEventListener('smart-env:context-changed', (e) => {
        const updated_ctx = e.detail.context;
        completion.thread.update_current_context(updated_ctx);
        render_context_container();
      });
    }
  }
  
  function scroll() {
    const message_container = completion.container.closest('.smart-chat-message-container');
    const {top: container_top, height: container_height} = message_container.getBoundingClientRect();
    const {top: target_top, height: target_height} = completion.container.getBoundingClientRect();
    if(target_height < (container_height - 100)) {
      completion.container.style.marginBottom = `${container_height - 100}px`;
    } else {
      completion.container.style.marginBottom = '';
    }
    const should_scroll = target_top > (container_top + 100);
    if (should_scroll){
      // // smooth scroll
      message_container.scrollTo({
        top: message_container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  return sequence_container;
}
async function update_action_message(completion) {
  if (completion.action_elm && completion.action_call) {
    this.empty(completion.action_elm);
    const action_call_frag = await completion.env.render_component('message_action', completion, { await_post_process: true });
    const action_call_elm = action_call_frag.querySelector('.smart-chat-message.action');
    this.empty(completion.action_elm);
    completion.action_elm.append(...action_call_elm.childNodes);
  }
}
