// Core model interfaces for Smart Models

// State types
export type AdapterState = 'unloaded' | 'loading' | 'loaded' | 'unloading';

// Model option for dropdown menus
export interface ModelOption {
  value: string;
  name: string;
}

// Settings config entry
export interface SettingsConfigEntry {
  name: string;
  type: string;
  description?: string;
  options_callback?: string;
  callback?: string;
  default?: unknown;
  is_scope?: boolean;
}

// Auth header options
export interface AuthHeaderOpts {
  headers?: Record<string, string>;
  api_key?: string;
  api_key_header?: string | 'none';
  warn_missing_api_key?: boolean;
  auth_scheme?: string;
}

// SmartModel constructor options
export interface SmartModelOpts {
  adapters?: Record<string, new (model: any) => any>;
  settings?: Record<string, any>;
  model_key?: string;
  adapter?: string;
  api_key?: string;
  http_adapter?: any;
  re_render_settings?: () => void;
  reload_model?: () => void;
  [key: string]: any;
}

export interface ModelData {
  model_key?: string;
  endpoint?: string;
  max_tokens?: number;
  dims?: number;
  id?: string;
  batch_size?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  provider_models?: Record<string, ModelInfo>;
  [key: string]: any;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  multimodal?: boolean;
  dims?: number;
  batch_size?: number;
  endpoint?: string;
  adapter?: string;
  model_name?: string;
  cost?: unknown;
  models_dev?: unknown;
  [key: string]: any;
}

// Adapter defaults
export interface AdapterDefaults {
  id?: string;
  description?: string;
  type?: string;
  endpoint?: string;
  endpoint_streaming?: string;
  adapter?: string;
  default_model?: string;
  streaming?: boolean;
  models_endpoint?: string;
  signup_url?: string;
  headers?: Record<string, string>;
  api_key_header?: string | 'none';
  [key: string]: any;
}

// Request/Response types for embed adapters
export interface EmbedInput {
  embed_input?: string;
  vec?: number[];
  tokens?: number;
  [key: string]: any;
}

export interface EmbedRequestBody {
  model: string;
  input: string[];
  dimensions?: number;
}

export interface EmbedResult {
  vec: number[];
  tokens: number;
}

// Request/Response types for chat adapters
export interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: string | object;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

export interface ChatMessage {
  role: string;
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  image_url?: string;
  index?: number;
}

export interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

export interface Tool {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model?: string;
  choices: ChatChoice[];
  usage?: TokenUsage;
  error?: ErrorResponse;
  raw?: any;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string;
  delta?: Partial<ChatMessage>;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ErrorResponse {
  message?: string;
  type?: string;
  code?: string | number;
}

// Chat request object passed to adapters
export interface ChatRequest {
  messages?: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: string | object;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  [key: string]: any;
}

// Stream event handlers
export interface StreamHandlers {
  chunk?: (resp: any) => void | Promise<void>;
  error?: (error: any) => void;
  done?: (resp: any) => void | Promise<void>;
}
