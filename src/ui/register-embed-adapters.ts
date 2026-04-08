export const RUNTIME_REGISTERED_EMBED_ADAPTERS = [
  'transformers',
  'openai',
  'ollama',
  'gemini',
  'lm_studio',
  'upstage',
  'open_router',
] as const;

import './embed-adapters/transformers';
import './embed-adapters/openai';
import './embed-adapters/ollama';
import './embed-adapters/gemini';
import './embed-adapters/lm-studio';
import './embed-adapters/upstage';
import './embed-adapters/open-router';
