import { SmartFs } from 'smart-file-system';
import { SmartFsObsidianAdapter } from 'smart-file-system/adapters/obsidian.js';
import { SmartView } from 'smart-view';
import { SmartViewObsidianAdapter } from 'smart-view/adapters/obsidian.js';
import { SmartSources, SmartSource } from 'smart-sources';
import { AjsonMultiFileSourcesDataAdapter } from "smart-sources/adapters/data/ajson_multi_file.js";
import { ObsidianMarkdownSourceContentAdapter } from "./adapters/smart-sources/obsidian_markdown.js";
import { BasesSourceContentAdapter } from "./adapters/smart-sources/bases.js";
import { ExcalidrawSourceContentAdapter } from "./adapters/smart-sources/excalidraw.js";
import { SmartBlocks, SmartBlock } from 'smart-blocks';
import { AjsonMultiFileBlocksDataAdapter } from "smart-blocks/adapters/data/ajson_multi_file.js";
import { MarkdownBlockContentAdapter } from "smart-blocks/adapters/markdown_block.js";
// import { Notice } from 'obsidian';
// import { SmartNotices } from "smart-notices/smart_notices.js"; // TODO: move to jsbrains
import { render as source_settings_component } from 'smart-sources/components/settings.js';
import { render as model_settings_component } from "smart-model/components/settings.js";
// smart model
import { SmartEmbedModel } from "smart-embed-model";
import { SmartEmbedOpenAIAdapter } from "smart-embed-model/adapters/openai.js";
import { SmartEmbedTransformersIframeAdapter } from "smart-embed-model/adapters/transformers_iframe.js";
import { SmartEmbedOllamaAdapter } from "smart-embed-model/adapters/ollama.js";
import { GeminiEmbedModelAdapter } from "smart-embed-model/adapters/gemini.js";
import { LmStudioEmbedModelAdapter } from "smart-embed-model/adapters/lm_studio.js";
// chat model
import { SmartChatModel } from "smart-chat-model";
import {
  SmartChatModelAnthropicAdapter,
  SmartChatModelAzureAdapter,
  // SmartChatModelCohereAdapter,
  SmartChatModelCustomAdapter,
  SmartChatModelGeminiAdapter,
  SmartChatModelGoogleAdapter,
  SmartChatModelGroqAdapter,
  SmartChatModelLmStudioAdapter,
  SmartChatModelOllamaAdapter,
  SmartChatModelOpenaiAdapter,
  SmartChatModelOpenRouterAdapter,
  SmartChatModelXaiAdapter,
  SmartChatModelDeepseekAdapter
} from "smart-chat-model/adapters.js";
import { SmartHttpRequest, SmartHttpObsidianRequestAdapter } from "smart-http-request";
import { requestUrl } from "obsidian";
import { smart_completions, SmartCompletion } from "smart-completions";
// actions architecture
import smart_block from "smart-blocks/smart_block.js";
import smart_source from "smart-sources/smart_source.js";
import { parse_blocks } from "smart-blocks/content_parsers/parse_blocks.js";
import { merge_env_config } from 'smart-environment/utils/merge_env_config.js';
const smart_env_config = {
  env_path: '',
  modules: {
    smart_fs: {
      class: SmartFs,
      adapter: SmartFsObsidianAdapter,
    },
    smart_view: {
      class: SmartView,
      adapter: SmartViewObsidianAdapter,
    },
    // smart_notices: {
    //   class: SmartNotices,
    //   adapter: Notice,
    // },
    smart_embed_model: {
      class: SmartEmbedModel,
      adapters: {
        transformers: SmartEmbedTransformersIframeAdapter,
        openai: SmartEmbedOpenAIAdapter,
        ollama: SmartEmbedOllamaAdapter,
        gemini: GeminiEmbedModelAdapter,
        lm_studio: LmStudioEmbedModelAdapter,
      },
    },
    smart_chat_model: {
      class: SmartChatModel,
      // DEPRECATED FORMAT: will be changed (requires SmartModel adapters getters update)
      adapters: {
        anthropic: SmartChatModelAnthropicAdapter,
        azure: SmartChatModelAzureAdapter,
        custom: SmartChatModelCustomAdapter,
        google: SmartChatModelGoogleAdapter,
        gemini: SmartChatModelGeminiAdapter,
        groq: SmartChatModelGroqAdapter,
        lm_studio: SmartChatModelLmStudioAdapter,
        ollama: SmartChatModelOllamaAdapter,
        open_router: SmartChatModelOpenRouterAdapter,
        openai: SmartChatModelOpenaiAdapter,
        xai: SmartChatModelXaiAdapter,
        deepseek: SmartChatModelDeepseekAdapter,
      },
      http_adapter: new SmartHttpRequest({
        adapter: SmartHttpObsidianRequestAdapter,
        obsidian_request_url: requestUrl,
      }),
    },
  },
  collections: {
    smart_sources: {
      collection_key: 'smart_sources',
      class: SmartSources,
      data_adapter: AjsonMultiFileSourcesDataAdapter,
      source_adapters: {
        "md": ObsidianMarkdownSourceContentAdapter,
        "txt": ObsidianMarkdownSourceContentAdapter,
        "excalidraw.md": ExcalidrawSourceContentAdapter,
        "base": BasesSourceContentAdapter,
        // "canvas": MarkdownSourceContentAdapter,
        // "default": MarkdownSourceContentAdapter,
      },
      content_parsers: [
        parse_blocks,
      ],
      // process_embed_queue: false,
      process_embed_queue: true, // trigger embedding on load
    },
    smart_blocks: {
      collection_key: 'smart_blocks',
      class: SmartBlocks,
      data_adapter: AjsonMultiFileBlocksDataAdapter,
      block_adapters: {
        "md": MarkdownBlockContentAdapter,
        "txt": MarkdownBlockContentAdapter,
        "excalidraw.md": MarkdownBlockContentAdapter,
        // "canvas": MarkdownBlockContentAdapter,
      },
    },
    smart_completions
  },
  item_types: {
    SmartSource,
    SmartBlock,
    SmartCompletion,
  },
  items: {
    smart_source,
    smart_block,
  },
  components: {
    smart_blocks: {
      settings: source_settings_component,
    },
    smart_embed_model: {
      settings: model_settings_component,
    },
  },
  default_settings: {
    is_obsidian_vault: true,
    smart_blocks: {
      embed_blocks: true,
      min_chars: 200,
    },
    smart_sources: {
      min_chars: 200,
      embed_model: {
        adapter: "transformers",
        transformers: {
          legacy_transformers: false,
          model_key: 'TaylorAI/bge-micro-v2',
        },
      },
      excluded_headings: '',
      file_exclusions: 'Untitled',
      folder_exclusions: '',
    },
    language: 'en',
    new_user: true, // DEPRECATED: 2025-06-05 (use localStorage instead)
    re_import_wait_time: 13,
    smart_chat_threads: {
      chat_model: {
        adapter: "ollama",
        ollama: {}
      },
    },
    smart_notices: {},
    smart_view_filter: {
      expanded_view: false,
      render_markdown: true,
      show_full_path: false,
    },
    version: "",
  },
};
import { smart_env_config as dist_config } from './smart_env.config.js';
merge_env_config(smart_env_config, dist_config);
export default smart_env_config;