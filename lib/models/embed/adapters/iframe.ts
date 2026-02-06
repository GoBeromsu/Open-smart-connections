import { SmartEmbedMessageAdapter } from "./_message";
import type { SmartModel } from 'smart-model';

/**
 * Adapter for running embedding models in an iframe
 * Provides isolation and separate context for model execution
 * @extends SmartEmbedMessageAdapter
 */
export class SmartEmbedIframeAdapter extends SmartEmbedMessageAdapter {
    iframe: HTMLIFrameElement | null;
    origin: string;
    iframe_id: string;
    use_gpu?: boolean;

    /**
     * Create iframe adapter instance
     */
    constructor(model: SmartModel) {
        super(model);
        this.iframe = null;
        this.origin = window.location.origin;
        this.iframe_id = `smart_embed_iframe`;
    }

    /**
     * Initialize iframe and load model
     * @returns {Promise<void>}
     */
    async load(): Promise<void> {
        // check if iframe already exists
        const existing_iframe = document.getElementById(this.iframe_id);
        if(existing_iframe) {
            // remove existing iframe
            existing_iframe.remove();
        }
        // Create and append iframe
        this.iframe = document.createElement('iframe');
        this.iframe.style.display = 'none';
        this.iframe.id = this.iframe_id;
        document.body.appendChild(this.iframe);
        // Set up message listener
        window.addEventListener('message', this._handle_message.bind(this));

        // Load the iframe content
        this.iframe.srcdoc = `
          <html>
            <body>
              <script type="module">
                ${this.connector}
                // Set up a message listener in the iframe
                window.addEventListener('message', async (event) => {
                    if (event.origin !== '${this.origin}' || event.data.iframe_id !== '${this.iframe_id}') return console.log('message ignored (listener)', event);
                    // Process the message and send the response back
                    const response = await process_message(event.data);
                    window.parent.postMessage({ ...response, iframe_id: '${this.iframe_id}' }, '${this.origin}');
                });
              </script>
            </body>
          </html>
        `;

        // Wait for iframe to load
        await new Promise<void>(resolve => { this.iframe!.onload = () => resolve(); });

        const load_opts: Record<string, any> = {
            // ...this.model.opts,
            model_key: this.model.model_key,
            adapters: null, // cannot clone classes
            settings: null,
            batch_size: this.batch_size,
            use_gpu: this.use_gpu,
        };
        // console.log({load_opts});
        // Initialize the model in the iframe
        await this._send_message('load', load_opts);

        return new Promise<void>(resolve => {
            const check_model_loaded = (): void => {
                if ((this.model as any).model_loaded) {
                    resolve();
                } else {
                    setTimeout(check_model_loaded, 100);
                }
            };
            check_model_loaded();
        });
    }

    /**
     * Post message to iframe
     * @protected
     * @param {Record<string, any>} message_data - Message to send
     */
    _post_message(message_data: Record<string, any>): void {
        this.iframe!.contentWindow!.postMessage({ ...message_data, iframe_id: this.iframe_id }, this.origin);
    }

    /**
     * Handle message from iframe
     * @private
     * @param {MessageEvent} event - Message event
     */
    _handle_message(event: MessageEvent): void {
        if (event.origin !== this.origin || event.data.iframe_id !== this.iframe_id) return;
        const { id, result, error } = event.data;
        this._handle_message_result(id, result, error);
    }
}
