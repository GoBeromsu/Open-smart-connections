import type { ModelInfo } from '../../types/models';

export const TRANSFORMERS_EMBED_MODELS: Record<string, ModelInfo> = {
  'TaylorAI/bge-micro-v2': { model_key: 'TaylorAI/bge-micro-v2', model_name: 'BGE-micro-v2', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 25, description: 'Local, 512 tokens, 384 dim (recommended)' },
  'Snowflake/snowflake-arctic-embed-xs': { model_key: 'Snowflake/snowflake-arctic-embed-xs', model_name: 'Snowflake Arctic Embed XS', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 25, description: 'Local, 512 tokens, 384 dim' },
  'Snowflake/snowflake-arctic-embed-s': { model_key: 'Snowflake/snowflake-arctic-embed-s', model_name: 'Snowflake Arctic Embed Small', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 35, description: 'Local, 512 tokens, 384 dim' },
  'Snowflake/snowflake-arctic-embed-m': { model_key: 'Snowflake/snowflake-arctic-embed-m', model_name: 'Snowflake Arctic Embed Medium', batch_size: 1, dims: 768, max_tokens: 512, size_mb: 90, description: 'Local, 512 tokens, 768 dim' },
  'TaylorAI/gte-tiny': { model_key: 'TaylorAI/gte-tiny', model_name: 'GTE-tiny', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 30, description: 'Local, 512 tokens, 384 dim' },
  'onnx-community/embeddinggemma-300m-ONNX': { model_key: 'onnx-community/embeddinggemma-300m-ONNX', model_name: 'EmbeddingGemma-300M', batch_size: 1, dims: 768, max_tokens: 2048, size_mb: 600, description: 'Local, 2,048 tokens, 768 dim' },
  'Mihaiii/Ivysaur': { model_key: 'Mihaiii/Ivysaur', model_name: 'Ivysaur', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 25, description: 'Local, 512 tokens, 384 dim' },
  'andersonbcdefg/bge-small-4096': { model_key: 'andersonbcdefg/bge-small-4096', model_name: 'BGE-small-4K', batch_size: 1, dims: 384, max_tokens: 4096, size_mb: 35, description: 'Local, 4,096 tokens, 384 dim' },
  'Xenova/jina-embeddings-v2-base-zh': { model_key: 'Xenova/jina-embeddings-v2-base-zh', model_name: 'Jina-v2-base-zh-8K', batch_size: 1, dims: 768, max_tokens: 8192, size_mb: 170, description: 'Local, 8,192 tokens, 768 dim, Chinese/English bilingual' },
  'Xenova/jina-embeddings-v2-small-en': { model_key: 'Xenova/jina-embeddings-v2-small-en', model_name: 'Jina-v2-small-en', batch_size: 1, dims: 512, max_tokens: 8192, size_mb: 35, description: 'Local, 8,192 tokens, 512 dim' },
  'Xenova/bge-m3': { model_key: 'Xenova/bge-m3', model_name: 'BGE-M3', batch_size: 1, dims: 1024, max_tokens: 8192, size_mb: 500, description: 'Local, 8,192 tokens, 1,024 dim' },
  'Xenova/multilingual-e5-large': { model_key: 'Xenova/multilingual-e5-large', model_name: 'Multilingual-E5-Large', batch_size: 1, dims: 1024, max_tokens: 512, size_mb: 400, description: 'Local, 512 tokens, 1,024 dim' },
  'Xenova/multilingual-e5-small': { model_key: 'Xenova/multilingual-e5-small', model_name: 'Multilingual-E5-Small', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 120, description: 'Local, 512 tokens, 384 dim' },
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': { model_key: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', model_name: 'Paraphrase-Multilingual-MiniLM-L12-v2', batch_size: 1, dims: 384, max_tokens: 128, size_mb: 120, description: 'Local, 128 tokens, 384 dim' },
  'nomic-ai/nomic-embed-text-v1.5': { model_key: 'nomic-ai/nomic-embed-text-v1.5', model_name: 'Nomic-embed-text-v1.5', batch_size: 1, dims: 768, max_tokens: 2048, size_mb: 140, description: 'Local, 8,192 tokens, 768 dim' },
  'Xenova/bge-small-en-v1.5': { model_key: 'Xenova/bge-small-en-v1.5', model_name: 'BGE-small', batch_size: 1, dims: 384, max_tokens: 512, size_mb: 35, description: 'Local, 512 tokens, 384 dim' },
  'nomic-ai/nomic-embed-text-v1': { model_key: 'nomic-ai/nomic-embed-text-v1', model_name: 'Nomic-embed-text', batch_size: 1, dims: 768, max_tokens: 2048, size_mb: 140, description: 'Local, 2,048 tokens, 768 dim' },
};
