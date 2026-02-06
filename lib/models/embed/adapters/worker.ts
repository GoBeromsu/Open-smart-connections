import { SmartEmbedMessageAdapter } from "./_message";
import type { SmartModel } from 'smart-model';

/**
 * Adapter for running embedding models in a Web Worker
 * Provides parallel processing in a separate thread
 * @extends SmartEmbedMessageAdapter
 */
export class SmartEmbedWorkerAdapter extends SmartEmbedMessageAdapter {
    worker: Worker | null;
    worker_id: string;
    worker_url!: URL;

    /**
     * Create worker adapter instance
     */
    constructor(model: SmartModel) {
        super(model);
        this.worker = null;
        this.worker_id = `smart_embed_worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    get global_key(): string {
        return `smart_embed_worker_${this.model.model_key}`;
    }
    /**
     * Initialize worker and load model
     * @returns {Promise<void>}
     */
    async load(): Promise<void> {

        if (!(this.model as any)[this.global_key]) {
            (this.model as any)[this.global_key] = new Worker(this.worker_url, { type: 'module' });
            console.log('new worker created', (this.model as any)[this.global_key]);
        }

        this.worker = (this.model as any)[this.global_key];
        console.log('worker', this.worker);
        console.log('worker_url', this.worker_url);

        // Set up message listener
        this.worker!.addEventListener('message', this._handle_message.bind(this));

        // Initialize the model in the worker
        await this._send_message('load', { ...{model_key: this.model.model_key, adapters: null, settings: null}, worker_id: this.worker_id });
        await new Promise<void>(resolve => {
            const check_model_loaded = (): void => {
                console.log('check_model_loaded', (this.model as any).model_loaded);
                if ((this.model as any).model_loaded) {
                    resolve();
                } else {
                    setTimeout(check_model_loaded, 100);
                }
            };
            check_model_loaded();
        });
        console.log('model loaded');
        this.set_state('loaded');
    }
    async unload(): Promise<void> {
        this._send_message('unload', { worker_id: this.worker_id });
        console.log('unload worker', this.worker);
        if(this.worker){
            this.worker.terminate();
            this.worker = null;
        }
        this.set_state('unloaded');
    }

    /**
     * Post message to worker
     * @protected
     * @param {Record<string, any>} message_data - Message to send
     */
    _post_message(message_data: Record<string, any>): void {
        this.worker!.postMessage({ ...message_data, worker_id: this.worker_id });
    }

    /**
     * Handle message from worker
     * @private
     * @param {MessageEvent} event - Message event
     */
    _handle_message(event: MessageEvent): void {
        const { id, result, error, worker_id } = event.data;
        if (worker_id !== this.worker_id) return;
        this._handle_message_result(id, result, error);
    }
}
