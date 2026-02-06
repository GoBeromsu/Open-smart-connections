/**
 * @file index.ts
 * @description Exports for core chat models
 */

export { ChatModel } from './ChatModel';
export { SmartStreamer } from './streamer';
export { ChatModelAdapter } from './adapters/_adapter';
export { ApiAdapter } from './adapters/_api_simplified';

// Export individual adapters
export { OpenAIAdapter } from './adapters/openai';

// Note: Other adapters from lib/models/chat/adapters/ need to be ported:
// - anthropic.ts
// - google.ts
// - gemini.ts (deprecated, redirects to google)
// - ollama.ts
// - azure.ts
// - cohere.ts
// - deepseek.ts
// - groq.ts
// - lm_studio.ts
// - open_router.ts
// - xai.ts
// - _custom.ts
//
// These adapters are copied from lib but need imports updated to use:
// - ApiAdapter from './_api_simplified' instead of SmartChatModelApiAdapter
// - Types from '../../../types/models' instead of '../../types'
// - Remove dependencies on SmartHttpRequest, SmartModel, etc.
