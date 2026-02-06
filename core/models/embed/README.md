# Embedding Models

This directory contains embedding model adapters for Smart Connections. All adapters implement the `EmbedModelAdapter` interface defined in `core/types/models.ts`.

## Architecture

### Base Classes

- **EmbedModel** (`EmbedModel.ts`): Main embedding model class that uses adapters
- **EmbedModelApiAdapter** (`adapters/_api.ts`): Base class for API-based adapters
- **EmbedModelRequestAdapter** (`adapters/_api.ts`): Base request adapter for API calls
- **EmbedModelResponseAdapter** (`adapters/_api.ts`): Base response adapter for API responses

### Adapters

#### Cloud-based API Adapters

1. **OpenAI** (`adapters/openai.ts`)
   - Models: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002
   - Uses tiktoken for accurate token counting
   - Supports dimension reduction for text-embedding-3 models

2. **Gemini** (`adapters/gemini.ts`)
   - Models: gemini-embedding-001
   - Handles rate limiting with automatic retry
   - Uses Google API key authentication

3. **Ollama** (`adapters/ollama.ts`)
   - Local API endpoint (default: http://localhost:11434)
   - Auto-discovers available embedding models
   - No API key required

4. **LM Studio** (`adapters/lm_studio.ts`)
   - Local API endpoint (default: http://localhost:1234)
   - Auto-discovers available models
   - No API key required

5. **Upstage** (`adapters/upstage.ts`)
   - Models: embedding-query, embedding-passage
   - OpenAI-compatible API format
   - Optimized for Korean/English mixed text

6. **OpenRouter** (`adapters/open_router.ts`)
   - Dynamic model discovery from OpenRouter API
   - OpenAI-compatible format
   - Filters for embedding models only

#### Local Transformers Adapter

**Transformers** (`adapters/transformers.ts`)
- Uses Web Worker for model loading and inference
- Supports both WebGPU and WASM backends with automatic fallback
- Models include: BGE-micro-v2, Snowflake Arctic Embed, Nomic Embed, Jina Embeddings, etc.
- See `worker/embed-worker.ts` for the worker implementation

## Web Worker

The `worker/embed-worker.ts` file contains a unified Web Worker implementation that:
- Loads Transformers.js from CDN
- Handles model loading with device fallback (WebGPU → WASM)
- Processes embedding requests in a separate thread
- Manages token counting and input truncation

## Key Changes from lib/

1. **Unified HTTP Requests**: Replaced `SmartHttpRequest` with Obsidian's `requestUrl()`
2. **TypeScript**: Full TypeScript implementation with proper types
3. **Consolidated Worker**: Single worker file instead of separate iframe/worker implementations
4. **Simplified Architecture**: Removed unnecessary abstraction layers

## Usage Example

```typescript
import { EmbedModel } from 'core/models/embed';
import { OpenAIEmbedAdapter, OPENAI_EMBED_MODELS } from 'core/models/embed';

// Create adapter
const adapter = new OpenAIEmbedAdapter({
  adapter: 'openai',
  model_key: 'text-embedding-3-small',
  dims: 1536,
  models: OPENAI_EMBED_MODELS,
  settings: {
    'openai.api_key': 'your-api-key',
  },
});

// Create model
const model = new EmbedModel({ adapter });

// Generate embeddings
const result = await model.embed('Hello world');
console.log(result.vec); // [0.1, 0.2, ...]
```

## Testing

All adapters should be tested for:
- Token counting accuracy
- Batch processing
- Error handling and retry logic
- API key validation
- Model loading and unloading
