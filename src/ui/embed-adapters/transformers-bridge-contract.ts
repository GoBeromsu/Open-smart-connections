const TRANSFORMERS_METHODS = [
  'load',
  'unload',
  'count_tokens',
  'embed_batch',
  'get_gpu_diag',
] as const;

export type TransformersMethod = typeof TRANSFORMERS_METHODS[number];

export interface TransformersRequestMessage {
  iframe_id: string;
  channel_token: string;
  id: number;
  method: TransformersMethod;
  params?: unknown;
}

export interface TransformersResponseMessage {
  iframe_id: string;
  channel_token: string;
  id?: number;
  type?: 'log' | 'fatal';
  result?: unknown;
  error?: string;
  message?: string;
}

export function create_bridge_secret(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues?.(bytes);
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function is_transformers_method(method: unknown): method is TransformersMethod {
  return typeof method === 'string'
    && (TRANSFORMERS_METHODS as readonly string[]).includes(method);
}

export function is_plain_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function build_transformers_request(
  iframe_id: string,
  channel_token: string,
  id: number,
  method: string,
  params?: unknown,
): TransformersRequestMessage {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error('Invalid transformers request id');
  }
  if (!is_transformers_method(method)) {
    throw new Error(`Unsupported transformers method: ${method}`);
  }
  return { iframe_id, channel_token, id, method, params };
}

export function parse_transformers_response(
  data: unknown,
  iframe_id: string,
  channel_token: string,
): TransformersResponseMessage | null {
  if (!is_plain_record(data)) return null;
  if (data.iframe_id !== iframe_id || data.channel_token !== channel_token) return null;
  if ('id' in data && !(typeof data.id === 'number' && Number.isSafeInteger(data.id))) return null;
  if ('type' in data && data.type !== 'log' && data.type !== 'fatal') return null;
  return data as unknown as TransformersResponseMessage;
}
