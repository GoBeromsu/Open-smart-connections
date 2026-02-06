import { SmartChatModelAnthropicAdapter } from './adapters/anthropic';
import { SmartChatModelAzureAdapter } from './adapters/azure';
import { SmartChatModelOpenaiAdapter } from './adapters/openai';
import { SmartChatModelGoogleAdapter, SmartChatModelGeminiAdapter } from './adapters/google';
import { SmartChatModelCohereAdapter } from './adapters/cohere';
import { SmartChatModelOpenRouterAdapter } from './adapters/open_router';
import { SmartChatModelCustomAdapter } from './adapters/_custom';
import { SmartChatModelOllamaAdapter } from './adapters/ollama';
import { SmartChatModelLmStudioAdapter } from './adapters/lm_studio';
import { SmartChatModelGroqAdapter } from './adapters/groq';
import { SmartChatModelXaiAdapter }  from './adapters/xai';
import { SmartChatModelDeepseekAdapter } from './adapters/deepseek';
export {
  SmartChatModelAnthropicAdapter,
  SmartChatModelAzureAdapter,
  SmartChatModelOpenaiAdapter,
  SmartChatModelGoogleAdapter,
  SmartChatModelCohereAdapter,
  SmartChatModelOpenRouterAdapter,
  SmartChatModelCustomAdapter,
  SmartChatModelOllamaAdapter,
  SmartChatModelLmStudioAdapter,
  SmartChatModelGroqAdapter,
  SmartChatModelXaiAdapter,
  SmartChatModelDeepseekAdapter,
  SmartChatModelAnthropicAdapter as anthropic,
  SmartChatModelAzureAdapter as azure,
  SmartChatModelCohereAdapter as cohere,
  SmartChatModelCustomAdapter as custom,
  SmartChatModelGoogleAdapter as google,
  SmartChatModelGroqAdapter as groq,
  SmartChatModelLmStudioAdapter as lm_studio,
  SmartChatModelOllamaAdapter as ollama,
  SmartChatModelOpenaiAdapter as openai,
  SmartChatModelOpenRouterAdapter as open_router,
  SmartChatModelXaiAdapter as xai,
  SmartChatModelDeepseekAdapter as deepseek,
  // DEPRECATED
  SmartChatModelGeminiAdapter,
  SmartChatModelGeminiAdapter as gemini
};
