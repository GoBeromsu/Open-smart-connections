/**
 * @module add_items_to_current_context
 * @description
 * Adds one or more vault paths to the *current* completion’s context in an
 * idempotent way:
 *   • creates a completion if none exists  
 *   • re‑uses the existing SmartContext when possible  
 *   • guarantees every `path` is present exactly once (no duplicates)  
 *
 * Pure (no DOM); suitable for unit testing.
 *
 * @param {import('../items/smart_chat_thread.js').SmartChatThread} thread
 * @param {string[]} paths                       vault‑relative paths
 * @returns {Promise<import('smart-contexts').SmartContext>} the updated context
 */
export async function add_items_to_current_context (thread, paths = []) {
  const env = thread.env;
  if (!paths.length) return null;

  const completion = thread.current_completion; // getter handles init if needed
  const ctx_key     = completion.data.context_key;
  const ctx         = ctx_key ? env.smart_contexts.get(ctx_key) : null;

  // 2. Merge the set {existing items ∪ new paths}
  const items_obj = Object.fromEntries(
    [
      ...(ctx ? Object.keys(ctx.data.context_items) : []),
      ...paths
    ].map(p => [p, { d: 0 }])
  );

  // 3. Upsert the SmartContext (reuse or new).
  const new_ctx = ctx
    ? (ctx.data.context_items = items_obj, ctx.queue_save(), ctx)             // mutate + save queue
    :  env.smart_contexts.new_context({ context_items: items_obj });

  // 4. Point the completion at the context and persist.
  completion.data.context_key = new_ctx.key;
  completion.queue_save();
  thread.queue_save();
  await env.smart_contexts.process_save_queue();

  return new_ctx;
}
