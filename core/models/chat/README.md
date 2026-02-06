# Chat Model Adapters - Core Module

## Overview

This module provides chat model adapters for the Smart Connections plugin. All adapters use Obsidian's native `requestUrl()` API instead of external HTTP libraries, and are fully typed with TypeScript.

## Quick Start

```typescript
import { ChatModel, OpenAIAdapter } from './core/models/chat';

// Create a chat model instance
const chatModel = new ChatModel({
  adapter: 'openai',
  adapters: {
    openai: OpenAIAdapter,
  },
  settings: {
    api_key: 'your-api-key',
    model_key: 'gpt-4o',
  },
});

// Complete a request
const response = await chatModel.complete({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
});

console.log(response.text);

// Stream a response
await chatModel.stream(
  {
    messages: [{ role: 'user', content: 'Tell me a story' }],
  },
  {
    onChunk: (chunk) => process.stdout.write(chunk),
    onClose: (fullText) => console.log('\n\nDone!'),
    onError: (error) => console.error('Error:', error),
  }
);
```

## Architecture

### Core Components

1. **ChatModel** - Main model manager
   - Handles adapter selection
   - Delegates to platform-specific adapters
   - Provides unified interface

2. **ChatModelAdapter** - Base adapter interface
   - Defines contract for all adapters
   - Provides common functionality

3. **ApiAdapter** - Base class for API-based adapters
   - Handles HTTP requests via `requestUrl()`
   - Manages streaming with `SmartStreamer`
   - Provides request/response transformation

4. **SmartStreamer** - Streaming client
   - XMLHttpRequest-based for SSE (Server-Sent Events)
   - Used by all API adapters for streaming responses

### File Structure

```
core/models/chat/
├── ChatModel.ts              # Main manager class
├── streamer.ts               # Streaming client
├── http.ts                   # HTTP utilities
├── index.ts                  # Exports
├── README.md                 # This file
├── MIGRATION.md              # Migration guide from lib/
├── STATUS.md                 # Current status
└── adapters/
    ├── _adapter.ts           # Base adapter interface
    ├── _api_simplified.ts    # API adapter base
    ├── openai.ts             # OpenAI (GPT models)
    ├── anthropic.ts          # Anthropic (Claude models)
    ├── google.ts             # Google (Gemini models)
    ├── ollama.ts             # Ollama (local models)
    ├── azure.ts              # Azure OpenAI
    ├── groq.ts               # Groq Cloud
    ├── open_router.ts        # OpenRouter
    ├── cohere.ts             # Cohere
    ├── deepseek.ts           # DeepSeek
    ├── lm_studio.ts          # LM Studio
    ├── xai.ts                # xAI (Grok)
    └── _custom.ts            # Custom adapter base
```

## Supported Adapters

| Adapter | Status | Description | API Key Required |
|---------|--------|-------------|------------------|
| **openai** | ✅ Ready | OpenAI GPT models (4o, 4o-mini, o1, etc.) | Yes |
| **anthropic** | ⏳ Pending | Anthropic Claude models (Opus, Sonnet, Haiku) | Yes |
| **ollama** | ⏳ Pending | Local Ollama models | No |
| **google** | ⏳ Pending | Google Gemini models | Yes |
| **azure** | ⏳ Pending | Azure OpenAI Service | Yes |
| **groq** | ⏳ Pending | Groq Cloud (fast inference) | Yes |
| **open_router** | ⏳ Pending | OpenRouter (multi-provider) | Yes |
| **cohere** | ⏳ Pending | Cohere Command models | Yes |
| **deepseek** | ⏳ Pending | DeepSeek models | Yes |
| **lm_studio** | ⏳ Pending | LM Studio local server | No |
| **xai** | ⏳ Pending | xAI Grok models | Yes |
| **custom** | ⏳ Pending | Custom/self-hosted endpoints | Varies |

## Key Features

### 1. Obsidian Native

All HTTP requests use Obsidian's `requestUrl()` API:
- No external HTTP libraries
- Respects Obsidian's security and CORS policies
- Works in all Obsidian environments (desktop, mobile)

### 2. Type-Safe

Full TypeScript with types from `core/types/models`:
```typescript
import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  StreamHandlers,
  ModelInfo,
} from '../../types/models';
```

### 3. Streaming Support

Adapters that support streaming use `SmartStreamer`:
```typescript
await adapter.stream(request, {
  onOpen: () => console.log('Stream started'),
  onChunk: (chunk) => console.log('Received:', chunk),
  onClose: (full) => console.log('Complete:', full),
  onError: (err) => console.error('Error:', err),
});
```

### 4. No Environment Dependencies

- No SmartModel or SmartEnv dependencies
- Standalone adapters that can be used anywhere
- Easy to test and maintain

## Creating a Custom Adapter

Extend the `ApiAdapter` base class:

```typescript
import { ApiAdapter } from './adapters/_api_simplified';
import type { ModelInfo, ChatRequest, HttpRequestParams } from '../../types/models';

export class MyCustomAdapter extends ApiAdapter {
  static key = 'my_custom';

  static defaults = {
    description: 'My Custom API',
    endpoint: 'https://api.example.com/v1/chat',
    streaming: true,
    default_model: 'custom-model-v1',
  };

  adapter = 'my_custom';
  can_stream = true;

  models: Record<string, ModelInfo> = {
    'custom-model-v1': {
      model_key: 'custom-model-v1',
      model_name: 'Custom Model v1',
      max_tokens: 4096,
    },
  };

  // Override if needed for platform-specific formatting
  protected prepare_request(req: ChatRequest, streaming: boolean): HttpRequestParams {
    // Custom request preparation
    return super.prepare_request(req, streaming);
  }

  protected parse_stream_chunk(chunk: string): string {
    // Custom chunk parsing
    return super.parse_stream_chunk(chunk);
  }
}
```

## Development Status

See [STATUS.md](./STATUS.md) for current implementation status.

See [MIGRATION.md](./MIGRATION.md) for migration guide from `lib/models/chat/`.

## Testing

```typescript
// Test completion
const response = await adapter.complete({
  messages: [{ role: 'user', content: 'Test message' }],
  max_tokens: 100,
});

assert(response.text, 'Should have response text');

// Test streaming
let accumulated = '';
await adapter.stream(
  { messages: [{ role: 'user', content: 'Test streaming' }] },
  {
    onChunk: (chunk) => accumulated += chunk,
    onClose: (full) => assert(full === accumulated),
  }
);

// Test API key validation
await adapter.test_api_key(); // Should not throw if valid
```

## Next Steps

1. Port remaining adapters (see STATUS.md)
2. Add comprehensive tests
3. Integrate with plugin settings UI
4. Add model selection UI
5. Add usage tracking and token counting

## References

- Type definitions: `core/types/models.ts`
- Migration guide: `MIGRATION.md`
- Implementation status: `STATUS.md`
- Obsidian API: https://docs.obsidian.md/Reference/TypeScript+API/requestUrl
