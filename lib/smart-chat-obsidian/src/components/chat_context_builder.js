import { thread_has_user_message } from '../utils/chat_context_utils.js';
import { ContextSelectorModal } from 'smart-context-obsidian/src/views/context_selector_modal.js';
import context_builder_css from 'smart-context-obsidian/src/components/context_builder.css' with { type: 'css' };

/**
 * build_html
 * @param {import('smart-contexts').SmartContext} ctx
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(ctx, opts = {}) {
  return `<div>
    <div class="sc-context-builder sc-chat-context-builder" data-context-key="${ctx.data.key}">
      <div class="sc-context-header"></div>
      <div class="sc-context-body">
        <div class="sc-context-tree"></div>
      </div>
      <div class="sc-context-footer">
        <div class="sc-context-stats"></div>
        <div class="sc-context-actions"></div>
      </div>
    </div>
  </div>`;
}

/**
 * render
 * @param {import('smart-contexts').SmartContext} ctx
 * @param {Object} opts
 * @returns {Promise<HTMLElement>}
 */
export async function render(ctx, opts = {}) {
  const html = build_html.call(this, ctx, opts);
  const frag = this.create_doc_fragment(html);
  const ctx_container = frag.querySelector('.sc-context-builder');
  this.apply_style_sheet(context_builder_css);
  await post_process.call(this, ctx, ctx_container, opts);
  return ctx_container;
}

/**
 * post_process – attaches chat‑specific behaviour.
 * Adds **Edit**, **Send**, and the new **Retrieve more** button.
 *
 * @param {import('smart-contexts').SmartContext} ctx
 * @param {HTMLElement} container
 * @param {Object} opts  – expects { completion }
 * @returns {Promise<HTMLElement>}
 */
export async function post_process(ctx, container, opts = {}) {
  const env        = ctx?.env;
  const completion = opts.completion;
  const thread          = completion.thread;
  const actions_el      = container.querySelector('.sc-context-actions');
  this.empty(actions_el);
  completion.thread?.container?.querySelector('.smart-chat-add-context-button')?.remove();
  if (Object.keys(ctx.data.context_items || {}).length === 0) {
    const btn = document.createElement('button');
    btn.className = 'smart-chat-add-context-button';
    btn.textContent = 'Add context';
    btn.addEventListener('click', () => {
      ContextSelectorModal.open(completion.env, {
        ctx           : null,
        opener_container: container,
      });
    });
    const wrap = document.createElement('div');
    wrap.className = 'smart-chat-add-context-container';
    wrap.appendChild(btn);
    container.appendChild(wrap);
    return container;
  }


  /* ------------------------------------------------------------------ */
  /* Edit button                                                         */
  /* ------------------------------------------------------------------ */
  if (completion === thread?.current_completion) {
    const edit_btn = document.createElement('button');
    edit_btn.textContent = 'Edit context';
    edit_btn.addEventListener('click', () =>
      ContextSelectorModal.open(env, {
        ctx,
        opener_container: container,
      })
    );
    actions_el.appendChild(edit_btn);
  }else{
    console.log("Not current completion, skipping edit button");
    container.classList.add('sc-context-done');
  }

  /* ------------------------------------------------------------------ */
  /* Retrieve more button                                                */
  /* ------------------------------------------------------------------ */
  if (thread_has_user_message(thread)) {
    const retrieve_btn = document.createElement('button');
    retrieve_btn.textContent = 'Retrieve more';
    retrieve_btn.addEventListener('click', () => {
      /* Create a follow‑up completion that reuses this context and
         instructs the model to call lookup_context again.              */
      const action_property = thread.collection.settings.use_tool_calls ? 'action_key' : 'action_xml_key';
      const next_completion = thread.init_completion({
        [action_property]: 'lookup_context',
        // Preserve the last user question so the model knows *why*
        user_message: thread.last_completion.data.user_message ?? '',
        action_opts: {
          context_key: ctx.key,
        }
      });
      env.render_component('completion', next_completion).then((next_container) => {
        thread.message_container.appendChild(next_container);
      });
      container.classList.add('sc-context-done');
    });
    actions_el.appendChild(retrieve_btn);
  }

  /* ------------------------------------------------------------------ */
  /* Send button                                                         */
  /* ------------------------------------------------------------------ */
  if (thread_has_user_message(thread)) {
    const send_btn = document.createElement('button');
    send_btn.textContent = 'Send';
    send_btn.addEventListener('click', async () => {
      actions_el.innerHTML = '';
      const typing =
        completion.thread?.message_container?.closest('.smart-chat-thread')
          ?.querySelector('.smart-chat-typing-indicator');
      if (typing) typing.style.display = 'block';
      await completion.env.render_component('completion', completion, {
        should_complete: true
      });
    });
    actions_el.appendChild(send_btn);
  }

  /* ------------------------------------------------------------------ */
  /* Re‑render tree & stats                                              */
  /* ------------------------------------------------------------------ */
  const tree_el  = container.querySelector('.sc-context-tree');
  const context_tree_container = await ctx.env.render_component('context_tree', ctx, {
    ...opts,
  });
  // add score to label if present in data.context_items{}.key.score
  const context_items_with_score = Object.entries(ctx.data.context_items)
    .filter(([key, value]) => {
      return value?.score !== undefined && value?.score !== null;
    })
    .forEach(([key, value]) => {
      const label = context_tree_container.querySelector(`.sc-tree-item[data-path="${key}"]`);
      if (label) {
        // const label_text = label.textContent;
        const score_span = this.create_doc_fragment(`<span class="sc-tree-score" title="Relevance score">${value.score.toFixed(2)}</span>`);
        // this.empty(label);
        label.insertAfter(score_span, label.querySelector('.sc-tree-remove'));
        // label.appendChild(document.createTextNode(` ${label_text}`));
      }
    });
  ;
  tree_el.replaceWith(
    context_tree_container
  );

  const stats_el = container.querySelector('.sc-context-stats');
  stats_el.replaceWith(
    await ctx.env.render_component('context_stats', ctx, { ...opts })
  );

  return container;
}
