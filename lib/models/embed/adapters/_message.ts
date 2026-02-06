import { SmartEmbedAdapter } from "./_adapter";
import type { SmartModel } from 'smart-model';
import type { EmbedInput } from '../../types';

interface MessageQueueEntry {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

interface MessageData {
    method: string;
    params: any;
    id: string;
    [key: string]: any;
}

/**
 * Base adapter for message-based embedding implementations (iframe/worker)
 * Handles communication between main thread and isolated contexts
 * @extends SmartEmbedAdapter
 *
 * @example
 * ```javascript
 * class MyMessageAdapter extends SmartEmbedMessageAdapter {
 *   _post_message(message_data) {
 *     // Implement message posting logic
 *   }
 * }
 * ```
 */
export class SmartEmbedMessageAdapter extends SmartEmbedAdapter {
    message_queue: Record<string, MessageQueueEntry>;
    message_id: number;
    connector: string | null;
    message_prefix: string;

    /**
     * Create message adapter instance
     */
    constructor(model: SmartModel) {
        super(model);
        /**
         * Queue of pending message promises
         */
        this.message_queue = {};

        /**
         * Counter for message IDs
         */
        this.message_id = 0;

        /**
         * Message connector implementation
         */
        this.connector = null;

        /**
         * Unique prefix for message IDs
         */
        this.message_prefix = `msg_${Math.random().toString(36).substr(2, 9)}_`;
    }

    /**
     * Send message and wait for response
     * @protected
     * @param {string} method - Method name to call
     * @param {any} params - Method parameters
     * @returns {Promise<any>} Response data
     */
    async _send_message(method: string, params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = `${this.message_prefix}${this.message_id++}`;
            this.message_queue[id] = { resolve, reject };
            this._post_message({ method, params, id });
        });
    }

    /**
     * Handle response message from worker/iframe
     * @protected
     * @param {string} id - Message ID
     * @param {any} result - Response result
     * @param {string} [error] - Response error
     */
    _handle_message_result(id: string, result: any, error?: string): void {
        if (!id.startsWith(this.message_prefix)) return;

        if (result?.model_loaded) {
            console.log('model loaded');
            this.state = 'loaded';
            (this.model as any).model_loaded = true; // DEPRECATED
            (this.model as any).load_result = result;
        }

        if (this.message_queue[id]) {
            if (error) {
                this.message_queue[id].reject(new Error(error));
            } else {
                this.message_queue[id].resolve(result);
            }
            delete this.message_queue[id];
        }
    }

    /**
     * Count tokens in input text
     * @param {string} input - Text to tokenize
     * @returns {Promise<{tokens: number}>} Token count result
     */
    async count_tokens(input: string): Promise<{ tokens: number }> {
        return this._send_message('count_tokens', { input });
    }

    /**
     * Generate embeddings for multiple inputs
     * @param {EmbedInput[]} inputs - Array of input objects
     * @returns {Promise<EmbedInput[]>} Processed inputs with embeddings
     */
    async embed_batch(inputs: EmbedInput[]): Promise<EmbedInput[]> {
        inputs = inputs.filter(item => (item.embed_input?.length ?? 0) > 0);
        if (!inputs.length) return [];
        const embed_inputs = inputs.map(item => ({ embed_input: item.embed_input }));
        const result = await this._send_message('embed_batch', { inputs: embed_inputs });

        return inputs.map((item, i) => {
            item.vec = result[i].vec;
            item.tokens = result[i].tokens;
            return item;
        });
    }

    /**
     * Post message to worker/iframe
     * @abstract
     * @protected
     * @param {MessageData} message_data - Message to send
     * @throws {Error} If not implemented by subclass
     */
    _post_message(message_data: MessageData): void {
        throw new Error('_post_message must be implemented by subclass');
    }
}
