# Open Smart Connections `v1.0.3`

## Bug Fixes

- **Fixed embedding model initialization error**: Resolved `Cannot read properties of undefined (reading 'default')` error when settings file is empty or `embed_model` settings are missing
- Added `embedding_models` getter to `SmartEnv` with proper fallback to default transformers model
- Made `embed_model` getter in `SmartEntities` null-safe using optional chaining

## Technical Changes

- `lib/jsbrains/smart-entities/smart_entities.js`: Simplified `embed_model` getter with optional chaining
- `lib/obsidian-smart-env/smart_env.js`: Added `embedding_models` getter with default settings fallback
- `lib/obsidian-smart-env/components/collection_settings.js`: Added null-safe check for embed_model settings rendering
