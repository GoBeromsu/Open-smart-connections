import { EMBED_CONNECTOR } from './transformers-connector';

export function create_transformers_srcdoc(iframe_id: string, channel_token: string): string {
  return `<html><body><script type="module">
${EMBED_CONNECTOR}
const IFRAME_ID = ${JSON.stringify(iframe_id)};
const CHANNEL_TOKEN = ${JSON.stringify(channel_token)};
const _origLog = console.log;
console.log = function(...args) {
  _origLog.apply(console, args);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (msg.startsWith('[SC:GPU]')) {
    window.parent.postMessage({ iframe_id: IFRAME_ID, channel_token: CHANNEL_TOKEN, type: 'log', message: msg }, '*');
  }
};
function post_fatal(error, id = null) {
  const message = error instanceof Error
    ? (error.stack || error.message || String(error))
    : String(error || 'Unknown iframe error');
  window.parent.postMessage({ iframe_id: IFRAME_ID, channel_token: CHANNEL_TOKEN, id, type: 'fatal', error: message }, '*');
}
window.addEventListener('error', (event) => { post_fatal(event.error || event.message, null); });
window.addEventListener('unhandledrejection', (event) => { post_fatal(event.reason, null); });

function is_trusted_parent_request(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.iframe_id !== IFRAME_ID || data.channel_token !== CHANNEL_TOKEN) return false;
  if (!Number.isSafeInteger(data.id) || data.id < 0) return false;
  return ['load', 'unload', 'count_tokens', 'embed_batch', 'get_gpu_diag'].includes(data.method);
}
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent) return;
  if (!is_trusted_parent_request(event.data)) return;
  try {
    const response = await process_message(event.data);
    window.parent.postMessage({ ...response, channel_token: CHANNEL_TOKEN }, '*');
  } catch (error) {
    post_fatal(error, event.data?.id ?? null);
  }
});
${'</'}script></body></html>`;
}

export function wait_for_iframe_load(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out waiting for transformers iframe to initialize.'));
    }, 15000);
    iframe.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    iframe.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Failed to initialize transformers iframe.'));
    };
  });
}
