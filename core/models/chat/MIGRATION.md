# Chat Model Adapters Migration to core/models/chat

## Overview

This document describes the migration of chat model adapters from `lib/models/chat/` to `core/models/chat/` with the following key changes:

1. **Replace SmartHttpRequest with Obsidian's `requestUrl()`**
2. **Use types from `core/types/models`**
3. **Remove SmartModel/SmartEnv dependencies**
4. **Full TypeScript with proper type safety**

## Architecture

### New Structure

```
core/models/chat/
├── ChatModel.ts              # Main chat model class (replaces SmartChatModel)
├── streamer.ts               # XMLHttpRequest-based streaming (unchanged)
├── http.ts                   # HTTP utilities using requestUrl()
├── index.ts                  # Barrel exports
├── adapters/
│   ├── _adapter.ts           # Base adapter class (simplified)
│   ├── _api_simplified.ts    # API adapter base with requestUrl()
│   ├── openai.ts             # ✅ PORTED
│   ├── anthropic.ts          # ⏳ TODO
│   ├── google.ts             # ⏳ TODO
│   ├── ollama.ts             # ⏳ TODO
│   ├── azure.ts              # ⏳ TODO
│   ├── cohere.ts             # ⏳ TODO
│   ├── deepseek.ts           # ⏳ TODO
│   ├── groq.ts               # ⏳ TODO
│   ├── lm_studio.ts          # ⏳ TODO
│   ├── open_router.ts        # ⏳ TODO
│   ├── xai.ts                # ⏳ TODO
│   └── _custom.ts            # ⏳ TODO
```

## Completed Work

### 1. Core Infrastructure ✅

- **ChatModel.ts**: Simplified model manager without SmartModel dependencies
- **streamer.ts**: XMLHttpRequest-based streaming client (unchanged from lib)
- **http.ts**: HTTP request utilities using Obsidian's `requestUrl()`
- **adapters/_adapter.ts**: Base adapter class with clean interface
- **adapters/_api_simplified.ts**: Simplified API adapter base class

### 2. Ported Adapters ✅

- **openai.ts**: Fully ported with simplified implementation

## Migration Pattern

Each adapter needs to be updated following this pattern:

### Before (lib version):
```typescript
import { SmartChatModelApiAdapter } from "./_api";
import { SmartHttpRequest } from "smart-http-request";

export class SmartChatModelOpenaiAdapter extends SmartChatModelApiAdapter {
  // Complex implementation with SmartModel dependencies
}
```

### After (core version):
```typescript
import { ApiAdapter } from './_api_simplified';
import type { ModelInfo } from '../../../types/models';

export class OpenAIAdapter extends ApiAdapter {
  static key = 'openai';
  static defaults = { /* config */ };

  // Simplified implementation using requestUrl()
}
```

## Key Changes

### 1. HTTP Layer

**Before:**
```typescript
const response = await this.http_adapter.request(params);
```

**After:**
```typescript
const response = await this.request(params);
// Uses Obsidian's requestUrl() internally
```

### 2. Type Imports

**Before:**
```typescript
import type { ModelInfo, ChatRequest } from '../../types';
```

**After:**
```typescript
import type { ModelInfo, ChatRequest } from '../../../types/models';
```

### 3. Base Class

**Before:**
```typescript
export class SmartChatModelOpenaiAdapter extends SmartChatModelApiAdapter {
  constructor(model: SmartChatModel) {
    super(model);
  }
}
```

**After:**
```typescript
export class OpenAIAdapter extends ApiAdapter {
  constructor(settings: AdapterConfig) {
    super(settings);
  }
}
```

### 4. Streaming

The streaming implementation uses the same `SmartStreamer` class but with `requestUrl()` for initial connection setup. The `ApiAdapter` base class handles all streaming logic.

## TODO: Remaining Adapters

The following adapters are copied from `lib/models/chat/adapters/` but need to be refactored:

### High Priority (commonly used)

1. **anthropic.ts** - Anthropic Claude models
   - Has custom message formatting
   - Different streaming format
   - Static model list (no API endpoint)

2. **ollama.ts** - Local Ollama models
   - Different endpoint structure (localhost)
   - No API key required
   - Dynamic model fetching from local instance

3. **google.ts / gemini.ts** - Google Gemini models
   - Custom chunk splitting regex for streaming
   - Different message format
   - gemini.ts is deprecated, redirects to google.ts

### Medium Priority

4. **azure.ts** - Azure OpenAI
   - Similar to OpenAI but different endpoint format
   - Different authentication

5. **groq.ts** - Groq Cloud API
   - OpenAI-compatible format
   - Simple port

6. **open_router.ts** - OpenRouter aggregator
   - OpenAI-compatible format
   - Multiple model providers

### Lower Priority

7. **cohere.ts** - Cohere Command models
8. **deepseek.ts** - DeepSeek models
9. **lm_studio.ts** - LM Studio local server
10. **xai.ts** - xAI Grok models
11. **_custom.ts** - Custom adapter base

## Migration Steps for Each Adapter

1. **Read the lib version** to understand platform-specific logic
2. **Extend ApiAdapter** instead of SmartChatModelApiAdapter
3. **Update imports** to use core/types
4. **Remove SmartModel dependencies** (model.data, model.re_render_settings, etc.)
5. **Simplify if possible** - remove unused features
6. **Override methods as needed**:
   - `prepare_request()` - for custom request formatting
   - `parse_response()` - for custom response parsing
   - `parse_stream_chunk()` - for custom streaming format
   - `is_end_of_stream()` - for custom stream end detection
   - `parse_model_data()` - for custom model list parsing

## Example: Porting Anthropic

```typescript
import { ApiAdapter } from './_api_simplified';
import type { ChatRequest, ModelInfo, HttpRequestParams } from '../../../types/models';

export class AnthropicAdapter extends ApiAdapter {
  static key = 'anthropic';
  static defaults = {
    description: 'Anthropic Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    streaming: true,
    api_key_header: 'x-api-key',
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'tools-2024-04-04',
    },
    models_endpoint: false, // Static model list
    default_model: 'claude-opus-4-1-20250805',
  };

  adapter = 'anthropic';
  can_stream = true;

  // Static model list
  models: Record<string, ModelInfo> = {
    'claude-opus-4-1-20250805': {
      model_key: 'claude-opus-4-1-20250805',
      model_name: 'Claude Opus 4.1',
      max_tokens: 200_000,
    },
    // ... more models
  };

  // Override request preparation for Anthropic format
  protected prepare_request(req: ChatRequest, streaming: boolean): HttpRequestParams {
    // Anthropic uses "messages" without system message
    // System message goes in separate "system" field
    const messages = req.messages.filter(m => m.role !== 'system');
    const system = req.messages.find(m => m.role === 'system')?.content;

    const body: any = {
      model: req.model_key || this.model_key,
      messages,
      max_tokens: req.max_tokens || 4096,
      stream: streaming,
    };

    if (system) body.system = system;

    return {
      url: this.endpoint,
      method: 'POST',
      headers: this.build_auth_headers({
        headers: {
          'Content-Type': 'application/json',
          ...OpenAIAdapter.defaults.headers,
        },
        api_key_header: AnthropicAdapter.defaults.api_key_header,
      }),
      body: JSON.stringify(body),
    };
  }

  // Override stream end detection
  protected is_end_of_stream(event: any): boolean {
    return event.data.includes('message_stop');
  }
}
```

## Testing

After porting each adapter:

1. Create a test instance:
```typescript
const adapter = new OpenAIAdapter({
  api_key: 'test-key',
  model_key: 'gpt-4o',
});
```

2. Test basic completion:
```typescript
const response = await adapter.complete({
  messages: [{ role: 'user', content: 'Hello' }],
});
```

3. Test streaming:
```typescript
await adapter.stream(
  { messages: [{ role: 'user', content: 'Hello' }] },
  {
    onChunk: (chunk) => console.log(chunk),
    onClose: (full) => console.log('Done:', full),
  }
);
```

## Benefits of New Architecture

1. **No SmartModel dependency** - Standalone adapters
2. **Uses Obsidian's requestUrl()** - Native Obsidian API
3. **Simpler code** - Removed complex caching and enrichment logic
4. **Type-safe** - Full TypeScript with proper types from core/types
5. **Easier to test** - No environment dependencies
6. **Easier to extend** - Clear base classes with documented override points

## Next Steps

1. Port remaining adapters one by one
2. Update ChatModel.ts to register all adapters
3. Create adapter factory/registry
4. Add comprehensive tests
5. Update plugin to use new chat model system
