import { AjsonMultiFileCollectionDataAdapter } from 'smart-collections/adapters/ajson_multi_file.js';
import { SmartFs } from 'smart-file-system/smart_fs.js';
import { SmartFsObsidianAdapter } from 'smart-file-system/adapters/obsidian.js';
import { SmartView } from 'smart-view/smart_view.js';
import { SmartViewObsidianAdapter } from 'smart-view/adapters/obsidian.js';
import { render as source_inspector_component } from 'obsidian-smart-env/components/source_inspector.js';

import smart_block from 'smart-blocks/smart_block.js';
import smart_source from 'smart-sources/smart_source.js';

export const smart_env_config = {
  env_path: '',
  collections: {
    smart_sources: {
      process_embed_queue: false,
    },
    smart_collections: {
      data_adapter: AjsonMultiFileCollectionDataAdapter,
    },
  },
  item_types: {},
  items: {
    smart_block,
    smart_source,
  },
  modules: {
    smart_fs: {
      class: SmartFs,
      adapter: SmartFsObsidianAdapter,
    },
    smart_view: {
      class: SmartView,
      adapter: SmartViewObsidianAdapter,
    },
  },
  components: {
    source_inspector: source_inspector_component,
  },
  default_settings: {
    is_obsidian_vault: true,
    smart_blocks: {
      embed_blocks: true,
      min_chars: 200,
    },
    smart_sources: {
      single_file_data_path: '.smart-env/smart_sources.json',
      min_chars: 200,
      embed_model: {
        adapter: 'transformers',
        transformers: {
          legacy_transformers: false,
          model_key: 'TaylorAI/bge-micro-v2',
        },
      },
      excluded_headings: '',
      file_exclusions: 'Untitled',
      folder_exclusions: '',
    },
    smart_view_filter: {
      render_markdown: true,
      show_full_path: false,
      exclude_blocks_from_source_connections: false,
      exclude_frontmatter_blocks: true,
    },
  },
};
