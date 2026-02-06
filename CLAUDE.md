This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Git strategy, branch naming, commit convention, and release management are defined in the **root CLAUDE.md**. This file covers plugin-specific details only.

## Project Overview

Open Smart Connections is an Obsidian plugin that uses local embeddings to surface semantically related notes. It provides a Connections view showing notes related to the current file and a Lookup view for semantic search across the vault.

## Build Commands

```bash
npm run build     # Build with esbuild, outputs to dist/
npm run test      # Run tests with AVA (npx ava --verbose)
npm run release   # Create GitHub release (requires GH_TOKEN and GH_REPO in .env)
```

The build process:
1. Auto-generates `smart_env.config.js` by scanning `src/` for collections, components, and actions
2. Bundles `src/main.js` to `dist/main.js` using esbuild
3. Copies `manifest.json` and `src/styles.css` to `dist/`
4. Optionally copies to vaults listed in `DESTINATION_VAULTS` env var (comma-separated)

## Local Development

Set `DESTINATION_VAULTS` in `.env` to automatically copy builds to test vaults:
```
DESTINATION_VAULTS=my-test-vault,another-vault
```

The build creates `.hotreload` files in destination plugins for Obsidian hot reload.

## Architecture

### Library Structure (lib/)

All dependencies are consolidated into `lib/` with a unified module structure. The library uses a single root package.json - individual packages no longer have their own package.json files.

```
lib/
├── core/                    # Core utilities and base classes
│   ├── utils/              # Utility functions (hash, deep, path, format, math, async, error)
│   ├── adapters/           # Base adapter classes
│   ├── collections/        # Collection framework
│   ├── fs/                 # File system abstraction
│   ├── http/               # HTTP request handling
│   ├── settings/           # Settings management
│   └── view/               # View rendering
├── models/                  # AI model integrations
│   ├── smart_model.js      # Base model class
│   ├── chat/               # Chat model adapters (OpenAI, Anthropic, etc.)
│   └── embed/              # Embedding model adapters (Transformers, OpenAI, etc.)
├── entities/                # Content entities
│   ├── smart_entity.js     # Base entity class
│   ├── smart_entities.js   # Entity collection
│   ├── sources/            # Source files (markdown, media, etc.)
│   └── blocks/             # Content blocks within sources
├── environment/             # Smart Environment runtime
│   ├── smart_env.js        # Environment orchestrator
│   └── notices/            # Notification system
└── obsidian/                # Obsidian-specific integrations
    ├── smart_env.js        # Obsidian SmartEnv extension
    ├── chat/               # Chat UI for Obsidian
    └── context/            # Context handling
```

### Plugin Structure (src/)

```
src/
├── index.js             # Plugin entry, extends SmartPlugin
├── collections/         # Collection classes (ConnectionsLists)
├── items/               # Item classes (ConnectionsList)
├── components/          # Renderable UI components (connections-view, connections-list, lookup)
├── views/               # Obsidian ItemView wrappers (ConnectionsItemView, LookupItemView)
├── actions/             # Processing actions (connections-list pre_process)
└── utils/               # Utility functions
```

### Smart Environment Config

`smart_env.config.js` is **auto-generated** by the build process. Do not edit directly. It aggregates:
- Collections from `src/collections/`
- Item types from `src/items/`
- Components from `src/components/`
- Actions from `src/actions/`

Components export a `render` function and optionally `settings_config`. Actions export action functions and optional `pre_process`.

### Error Handling with SmartNotice

Use the `SmartNotice` utility for centralized error handling and user notifications:
- Provides consistent error messaging across the plugin
- Handles both transient notices and persistent error states
- Integrates with the Obsidian notification system
- Supports different severity levels (info, warning, error)

Example usage:
```javascript
import { SmartNotice } from './lib/environment/notices/smart_notice.js';

// Show a notice to the user
SmartNotice.show('Operation completed successfully');

// Show an error notice
SmartNotice.error('Failed to load embeddings');
```

### Views vs Components

- **Views** (`src/views/`): Obsidian ItemView subclasses that register with the workspace
- **Components** (`src/components/`): Reusable render functions that return DocumentFragments

Views use `env.smart_components.render_component()` or `env.render_component()` to render components.

### ConnectionsList Pattern

Each source item gets a `ConnectionsList` that:
1. Calls `pre_process()` to prepare scoring params
2. Runs `filter_and_score()` across the target collection
3. Applies optional `post_process()` action
4. Merges pinned results

## Testing

Tests use AVA and are co-located with source files (e.g., `pause_controls.test.js`). Run a single test file:
```bash
npx ava src/utils/pause_controls.test.js --verbose
```

## Key Files

- `src/main.js` - Plugin class with commands, ribbon icons, and initialization
- `src/views/connections_item_view.js` - Main connections panel logic
- `src/collections/connections_lists.js` - ConnectionsLists collection with settings
- `src/items/connections_list.js` - ConnectionsList item with scoring pipeline
- `esbuild.js` - Build configuration with CSS and markdown plugins

## Future Plans

The project is planning a TypeScript conversion to improve type safety and developer experience. When contributing new code, consider:
- Using JSDoc type annotations where possible
- Following patterns that will translate well to TypeScript
- Keeping modules small and focused for easier conversion

## Resources

- Obsidian Plugin API Docs: https://docs.obsidian.md/Home

## CDP Testing

Use `obsidian-cdp` skill for Playwright CDP automation:
- Enable plugin: `enablePlugin(id)` + `enabledPlugins.add()` + `saveConfig()`
- Check settings: `window.app.plugins.plugins['open-smart-connections'].settings`
- Verify plugin load status with `verify-plugin.mjs`
- Capture UI state with `screenshot.mjs`

## Current Known Issues

- Chat model config conflict: `open_router` vs `ollama`, model_key `"undefined"` problem
- `90. Settings` folder caught by folder_exclusions
- After `enablePlugin()`, the `enabledPlugins` Set requires manual sync

## Hot Reload

- `DESTINATION_VAULTS` in `.env` auto-copies builds to vault on build
- `.hotreload` file triggers Obsidian change detection
