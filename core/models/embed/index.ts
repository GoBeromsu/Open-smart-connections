/**
 * @file index.ts
 * @description Export all embedding model adapters and base classes
 */

export { EmbedModel } from './EmbedModel';
export type { EmbedModelOptions } from './EmbedModel';

export {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './adapters/_api';

export { OpenAIEmbedAdapter, OPENAI_EMBED_MODELS } from './adapters/openai';
export { OllamaEmbedAdapter, filter_embedding_models } from './adapters/ollama';
export { GeminiEmbedAdapter, GEMINI_EMBED_MODELS } from './adapters/gemini';
export { LmStudioEmbedAdapter, parse_lm_studio_models } from './adapters/lm_studio';
export { UpstageEmbedAdapter, UPSTAGE_EMBED_MODELS } from './adapters/upstage';
export { OpenRouterEmbedAdapter } from './adapters/open_router';
export { TransformersEmbedAdapter, TRANSFORMERS_EMBED_MODELS } from './adapters/transformers';
