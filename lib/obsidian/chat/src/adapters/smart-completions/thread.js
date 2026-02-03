import { SmartCompletionAdapter } from 'smart-completions/adapters/_adapter.js';

/**
 * @class ThreadCompletionAdapter
 * @extends SmartCompletionAdapter
 *
 * This adapter checks `item.data.thread`, retrieves that thread from `env.smart_threads`,
 * and appends each message from the thread into `completion.request.messages`.
 */
export class ThreadCompletionAdapter extends SmartCompletionAdapter {
  static version = 0.1;
  static order = -1;
  /**
   * @returns {string}
   */
  static get property_name() {
    return 'thread_key';
  }
  static item_constructor(completion){
    Object.defineProperty(completion, 'thread', {
      get(){
        const thread_key = completion.data.thread_key;
        if(!thread_key) return null;
        return completion.env.smart_chat_threads.get(thread_key)
          || completion.env.smart_chat_threads.active_thread // TEMP 2025-07-30: fallback to active thread (for handling legacy data from threads saved with different key)
        ;
      }
    });
  }

  /**
   * to_request: Appends messages from the referenced thread.
   * @returns {Promise<void>}
   */
  async to_request() {
    const thread_key = this.data.thread_key;
    if(!thread_key) return;

    const thread = this.item.thread || this.item.env.smart_chat_threads.get(thread_key) || this.item.env.smart_chat_threads.active_thread;
    if (thread.current_completion.key !== this.item.key) return console.log('ThreadCompletionAdapter: skipping thread, not the current completion');

    const thread_collection = this.item.env.smart_chat_threads;
    if(!thread_collection) {
      console.warn("No 'smart_chat_threads' collection found in environment; skipping thread adapter.");
      return;
    }
    const thread_item = thread_collection.get(thread_key);
    if(!thread_item || !Array.isArray(thread_item.messages)) {
      console.warn(`Thread item '${thread_key}' not found or missing .data.messages array`);
      return;
    }

    if(!this.request.messages) {
      this.request.messages = [];
    }
    const prior_completions = thread_item.completions.slice(0, -1);
    for(let i = 0; i < prior_completions.length; i++){
      const prior_completion = prior_completions[i];
      this.request.messages.push(...(await prior_completion.build_request()).messages || []);
      this.request.messages.push({role: 'assistant', content: prior_completion.response_text});
    }
    // remove messages with the same content (FIFO) to prevent repeating duplicate context
    const seen = new Set();
    this.request.messages = this.request.messages.filter(msg => {
      // Handle array content by stringifying for comparison
      const contentKey = Array.isArray(msg.content) ? JSON.stringify(msg.content) : msg.content;
      if (seen.has(contentKey)) return false;
      seen.add(contentKey);
      return true;
    });
  }

  /**
   * from_response: No post-processing needed for thread.
   * @returns {Promise<void>}
   */
  async from_response() {
    const thread = this.item.thread;
    if(!thread) return console.warn('No thread found');
    setTimeout(() => {
      thread.queue_save();
      thread.collection.process_save_queue();
    }, 1000);
  }
}
