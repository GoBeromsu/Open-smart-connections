/**
 * @file message_system.js
 * @description Renders a system/prompt message in the chat log. 
 * No "bubble" style; simply small dim text.
 */

/**
 * @function build_html
 * @param {Object} completion - The SmartCompletion item
 * @param {Object} opts
 * @returns {string}
 */
export function build_html(completion, opts = {}) {
  const action = completion.data.action_key;
  let action_data = completion.action_call;
  if(typeof action_data === 'string'){
    if(action_data.endsWith('"}')){
      // do nothing, is well-formed JSON
    } else if(action_data.endsWith('",')){
      action_data = action_data.slice(0, -1) + '}';
    } else if(action_data.endsWith('","')){
      action_data = action_data.slice(0, -2) + '"}';
    } else if(action_data.endsWith('"')){
      // Handle case where string ends with a quote but needs closing brace
      action_data = action_data + '}';
    } else if(action_data.endsWith('{')){
      // Handle empty object
      action_data = action_data + '}';
    } else if(action_data.endsWith('":')){
      // Handle case where string ends with a colon but needs closing brace
      action_data = action_data + '""}';
    }else if(!action_data.endsWith(']}')){
      action_data = action_data + '"}';
    }
    if(action_data.includes('[') && !action_data.includes(']')){
      action_data = action_data.slice(0, -1) + ']}';
    }
    try {
      // Format the JSON with proper indentation
      const parsed = JSON.parse(action_data);
      if(parsed.final) delete parsed.final;
      action_data = JSON.stringify(parsed, null, 2);
    } catch (e) {
      console.warn('Failed to parse action_data as JSON:', e, completion.action_call, action_data);
      const last_good_i = action_data.lastIndexOf('",');
      if(last_good_i !== -1){
        action_data = action_data.slice(0, last_good_i) + '"}';
        try {
          action_data = JSON.stringify(JSON.parse(action_data), null, 2);
        } catch (e) {
          action_data = "Failed to parse action call.";
          console.warn('Failed to parse action_data as JSON:', e, completion.action_call, action_data);
        }
      }
    }
  }else if(action_data && typeof action_data === 'object'){
    action_data = JSON.stringify(action_data, null, 2);
  }else{
    action_data = '...';
  }
  // Wrap in .smart-chat-message.system but style is controlled in CSS to remove bubble style
  return `<div>
    <div class="smart-chat-message action">
      <div class="smart-chat-message-content">${action}${action_data ? `<pre style="white-space: pre-wrap;">${action_data}</pre>` : ''}</div>
    </div>
  </div>`;
}

/**
 * @function render
 * @description Builds and renders the system message component, then calls post_process.
 * @param {Object} completion - The SmartCompletion item
 * @param {Object} opts
 * @returns {Promise<DocumentFragment>}
 */
export async function render(completion, opts = {}) {
  const html = build_html(completion, opts);
  const frag = this.create_doc_fragment(html);
  if(opts.await_post_process){
    await post_process.call(this, completion, frag, opts);
  }else{
    post_process.call(this, completion, frag, opts);
  }
  return frag;
}

/**
 * @function post_process
 * @description If needed, attaches events or interactive elements in the system message.
 * @param {Object} completion
 * @param {DocumentFragment} frag
 * @param {Object} opts
 * @returns {DocumentFragment}
 */
export function post_process(completion, frag, opts = {}) {
  // Currently no additional interactive elements, so just return frag
  return frag;
}
