# Open Smart Connections

An Obsidian plugin that uses AI embeddings to surface semantically related notes. Works offline with local models, or connect to any major embedding provider.

> Community-maintained fork of [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) by Brian Petro, rebuilt for stability and extensibility.

## Features

- **Zero-setup local embeddings** -- runs TaylorAI/bge-micro-v2 in-browser via Transformers.js, no API key needed
- **Multilingual local models** -- includes `Xenova/bge-m3` and multilingual E5 variants for non-English vaults
- **7 embedding providers** -- Transformers (local), OpenAI, Ollama, Gemini, LM Studio, Upstage, OpenRouter
- **Dynamic model selection** -- settings UI auto-discovers models from API providers
- **Model fingerprint re-embed safety** -- forces re-embedding when adapter, model, or host changes
- **Privacy-first** -- your notes never leave your device with local models
- **Mobile support** -- works on iOS and Android
- **Connections View** -- see related notes as you navigate your vault
- **Semantic search (Lookup)** -- find notes by meaning, not just keywords

## Quick Start

### Install from Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/GoBeromsu/Open-smart-connections/releases/latest)
2. Create `.obsidian/plugins/open-smart-connections/` in your vault
3. Copy the three files into that folder
4. Enable **Open Smart Connections** in Settings > Community Plugins

### Build from Source

```bash
git clone https://github.com/GoBeromsu/Open-smart-connections.git
cd Open-smart-connections
pnpm install
pnpm run build
```

Copy `dist/` contents to your vault's `.obsidian/plugins/open-smart-connections/` directory.

## Usage

1. Open **Settings > Open Smart Connections**
2. Choose an **embedding provider** (default: Transformers local)
3. Select a **model** from the dropdown
4. For API providers, enter your API key
5. Open the **Connections** view from the ribbon or command palette
6. Navigate your vault -- related notes appear automatically

## Embedding Providers

| Provider | Type | Models | API Key |
|----------|------|--------|---------|
| Transformers | Local (in-browser) | bge-micro-v2, bge-m3, multilingual-e5-large/small, paraphrase-multilingual-MiniLM-L12-v2, bge-small, nomic-embed, jina-v2 | No |
| OpenAI | API | text-embedding-3-small/large, ada-002, + dim variants | Yes |
| Ollama | Local (server) | Any pulled embedding model (+ recommended quick picks) | No |
| Gemini | API | gemini-embedding-001 | Yes |
| LM Studio | Local (server) | Any loaded embedding model | No |
| Upstage | API | embedding-query, embedding-passage | Yes |
| OpenRouter | API | Auto-discovered embedding models | Yes |

### Recommended Local Models

- `Xenova/bge-m3` -- high-quality multilingual local option
- `Xenova/multilingual-e5-large` -- higher-quality multilingual retrieval
- `Xenova/multilingual-e5-small` -- lighter multilingual option
- `Xenova/paraphrase-multilingual-MiniLM-L12-v2` -- compact multilingual baseline

### Ollama Quick Picks

- `bge-m3`
- `nomic-embed-text`
- `snowflake-arctic-embed2`
- `mxbai-embed-large`

## Tech Stack

| Category | Technology |
|----------|------------|
| Platform | Obsidian Plugin API |
| Language | TypeScript, JavaScript |
| Bundler | esbuild |
| Embeddings | Transformers.js (WebGPU + WASM fallback), OpenAI, Ollama, Gemini, LM Studio, Upstage, OpenRouter |
| Storage | PGlite (SQLite-compatible) |
| Testing | Vitest |

## Project Structure

```
obsidian-smart-connections/
├── src/
│   ├── app/                    # Plugin entry, commands, settings, status bar, file watcher
│   │   └── main.ts             # SmartConnectionsPlugin (extends Plugin)
│   ├── features/
│   │   ├── connections/        # Connections view (related notes for active file)
│   │   ├── embedding/          # Embedding manager, kernel state machine, job queue
│   │   └── lookup/             # Lookup view (semantic search across vault)
│   ├── shared/
│   │   ├── entities/           # Source/Block data model + PGlite adapter
│   │   ├── models/embed/       # EmbedModel + provider adapters (7 providers)
│   │   ├── search/             # find-connections, lookup, vector-search
│   │   └── utils/              # Cosine similarity, hashing, etc.
│   └── views/                  # Result context menu
├── worker/
│   └── embed-worker.ts         # Web Worker for Transformers.js embedding
├── test/                       # Vitest tests
├── dist/                       # Build output (gitignored)
├── scripts/                    # dev.mjs, version.mjs, release.mjs
└── manifest.json               # Obsidian plugin manifest
```

## Development

```bash
pnpm install
pnpm dev              # vault selection + esbuild watch + hot reload
pnpm build            # production build to dist/
pnpm test             # Vitest unit tests
pnpm lint             # ESLint (src/ and worker/)
pnpm run ci           # build + lint + test
pnpm typecheck        # tsc --noEmit
```

## Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, etc.)
4. Run `pnpm run ci` to verify
5. Submit a pull request

## License

**GNU General Public License v3.0** (GPL-3.0)

### Attribution

This is a modified version of [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) originally created by [Brian Petro](https://github.com/brianpetro).

- Original Copyright (C) Brian Petro
- Fork maintained by the community

Per GPL-3.0 Section 5, this modified version is clearly marked as different from the original.

## Links

- [Releases](https://github.com/GoBeromsu/Open-smart-connections/releases)
- [Original Repository](https://github.com/brianpetro/obsidian-smart-connections)
- [Original Documentation](https://smartconnections.app/)
- [Obsidian](https://obsidian.md/)

---

*This fork is not affiliated with or endorsed by the original Smart Connections project.*
