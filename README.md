# Open Connections

**Your notes, semantically connected.** A powerful Obsidian plugin that discovers related notes and enables semantic search across your entire vault—powered by local embeddings or your favorite AI provider.

![Version](https://img.shields.io/badge/version-3.9.13-blue) ![License](https://img.shields.io/badge/license-GPL--3.0-green) ![Desktop Only](https://img.shields.io/badge/platform-desktop--only-gray)

## Why Open Connections?

Open Connections bridges the gap between simple keyword search and intelligent semantic discovery. As you write in Obsidian, it automatically surfaces notes that are semantically related to your current file—not just keyword matches, but conceptually connected ideas. It works entirely on your machine with local embeddings, or seamlessly integrates with OpenAI, Gemini, Ollama, and other providers.

## Features

- **Local embeddings by default** — Zero API keys, zero setup. Runs Transformers.js in-browser with WebGPU acceleration (WASM fallback)
- **Multi-provider support** — Use Transformers (local), OpenAI, Gemini, Ollama, LM Studio, Upstage, or OpenRouter
- **Connections View** — See related notes as you navigate. Auto-updates when you open a file
- **Semantic Lookup** — Search your vault by meaning, not keywords. Find what you're looking for instantly
- **Multilingual** — Local models include multilingual variants for non-English vaults
- **Privacy-first** — Your notes never leave your device when using local embeddings
- **Fast SQLite cache** — Embeddings are stored locally and reused across sessions
- **Model fingerprinting** — Automatically re-embeds when you change providers or models
- **Status bar progress** — See embedding progress in real-time
- **Mobile support** — Works on iOS and Android

## Quick Start

### Installation

#### From Community Plugin Browser (Recommended)

1. Open Obsidian and go to **Settings > Community Plugins**
2. Disable Safe Mode if enabled
3. Click **Browse** and search for "Open Connections"
4. Click **Install**, then **Enable**

#### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/GoBeromsu/Open-smart-connections/releases/latest)
2. Create `.obsidian/plugins/open-connections/` in your vault
3. Copy the three files into that directory
4. Enable **Open Connections** in Settings > Community Plugins

#### Build from Source

```bash
git clone https://github.com/GoBeromsu/Open-smart-connections.git
cd open-connections
pnpm install
pnpm run build
```

Copy `dist/` contents to your vault's `.obsidian/plugins/open-connections/` directory.

### First Steps

1. Open **Settings > Open Connections**
2. Choose an embedding provider (default: Transformers local)
3. Select a model from the dropdown
4. For API providers, enter your API key
5. Open the **Connections** view from the ribbon icon
6. Start navigating your vault—related notes appear automatically

## How It Works

**Embeddings** are the core of semantic search. They convert text into mathematical vectors that capture meaning. Open Connections uses these vectors to find notes that are semantically similar.

```
┌─────────────────┐
│  Your Notes     │
└────────┬────────┘
         │
    ┌────▼─────┐
    │ Embedding │  (Local Transformers.js or API provider)
    │  Model    │
    └────┬─────┘
         │
    ┌────▼──────────────┐
    │ SQLite Cache      │  (Fast, persistent storage)
    └────┬──────────────┘
         │
    ┌────▼────────────────────┐
    │ Semantic Search Engine  │
    │ • Connections View      │
    │ • Lookup View           │
    └─────────────────────────┘
```

### Two Main Views

**Connections View** — Shows notes semantically related to the file you're currently viewing. Updates automatically as you navigate.

**Lookup View** — Semantic search across your entire vault. Type a query and find notes by meaning, not just keywords.

## Embedding Providers

Open Connections supports multiple embedding providers. Choose what works best for your workflow:

| Provider | Type | Quality | Speed | Cost | API Key Required | Notes |
|----------|------|---------|-------|------|------------------|-------|
| **Transformers** | Local (in-browser) | High | Fast | Free | No | Default. WebGPU accelerated. No setup. |
| **OpenAI** | API | Very High | Fast | $ | Yes | Most accurate. Supports dimension reduction. |
| **Gemini** | API | High | Fast | Free tier | Yes | Google's embedding model. Generous free tier. |
| **Ollama** | Local (server) | Variable | Variable | Free | No | Run any HuggingFace model locally. Requires Ollama running. |
| **LM Studio** | Local (server) | Variable | Variable | Free | No | Desktop app for local model hosting. |
| **Upstage** | API | High | Fast | $ | Yes | Korean AI startup. Excellent multilingual support. |
| **OpenRouter** | API | High | Fast | $ | Yes | Access multiple models through one API. |

### Recommended Configurations

**Best for privacy (local, zero setup):**
```
Provider: Transformers
Model: Xenova/bge-micro-v2 (default, fast, good quality)
```

**Best for quality (API):**
```
Provider: OpenAI
Model: text-embedding-3-small or text-embedding-3-large
```

**Best for multilingual vaults (local):**
```
Provider: Transformers
Model: Xenova/bge-m3 (multilingual, high quality)
```

**Best for multilingual vaults (API, free tier):**
```
Provider: Gemini
Model: gemini-embedding-001
```

**Best for self-hosted (local server):**
```
Provider: Ollama
Model: nomic-embed-text or bge-m3 (after pulling)
```

## Usage

### Connections View

1. Open any note in your vault
2. The Connections View automatically shows related notes
3. Click any result to jump to that note
4. Results update as you navigate between files

**Tip:** Pin the Connections View in your sidebar for always-on semantic discovery as you work.

### Lookup View

1. Open the **Lookup** view from the ribbon or command palette
2. Type a query in plain language (e.g., "project management tips", "climate change", "meeting notes")
3. See matching notes ranked by relevance
4. Click a result to open it

**Tip:** Lookup finds notes by meaning, not exact keywords. Describe what you're looking for conceptually.

### Commands

Access these from the Command Palette (Cmd/Ctrl + P):

- **Open Connections: Open Connections View** — Show the Connections panel
- **Open Connections: Open Lookup View** — Show the Lookup panel
- **Open Connections: Re-embed all notes** — Force a full re-embedding of your vault (useful after changing providers/models)
- **Open Connections: Open settings** — Jump to plugin settings

## Configuration

### Settings Tab

**Embedding Provider** — Choose where embeddings come from (local or API).

**Model Selection** — The plugin auto-discovers available models from your chosen provider. For API providers, ensure your API key is set first.

**Connection Count** — How many related notes to show in the Connections View (default: 5).

**API Keys** — Store credentials for OpenAI, Gemini, Upstage, OpenRouter, etc. Keys are stored in Obsidian's encrypted settings.

**Advanced** — Model fingerprinting, cache management, re-embedding triggers.

### Environment Variables

For development or advanced configuration, set these in a `.env` file:

```
OPENAI_API_KEY=your-key-here
GEMINI_API_KEY=your-key-here
OLLAMA_HOST=http://localhost:11434
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Platform** | Obsidian Plugin API |
| **Language** | TypeScript 5, JavaScript |
| **Bundler** | esbuild |
| **Embeddings** | Transformers.js (WebGPU + WASM), OpenAI, Gemini, Ollama, LM Studio, Upstage, OpenRouter |
| **Storage** | SQLite (node:sqlite) |
| **Parallelism** | Web Workers (embedding in background) |
| **Testing** | Vitest |

## Project Architecture

```
open-connections/
├── src/
│   ├── main.ts                   # Plugin entry point
│   ├── domain/                   # Business logic (NO obsidian imports)
│   │   ├── config.ts             # Settings, notice catalog
│   │   ├── embed-model.ts        # Embedding adapter registry
│   │   ├── embedding-pipeline.ts # Batch embedding pipeline
│   │   ├── entities/             # Data model (Source, Block, Collection)
│   │   └── embedding/kernel/     # Redux-style state machine
│   ├── ui/                       # Obsidian-dependent UI
│   │   ├── ConnectionsView.ts    # Related notes panel
│   │   ├── LookupView.ts         # Semantic search panel
│   │   ├── embed-adapters/       # 7 provider adapters
│   │   ├── settings.ts           # Settings UI
│   │   ├── status-bar.ts         # Progress bar
│   │   └── commands.ts           # Command palette commands
│   ├── types/                    # Pure type definitions
│   ├── utils/                    # Pure utility functions
│   └── shared/                   # Shared boiler-template code
├── worker/
│   └── embed-worker.ts           # Web Worker for Transformers.js
├── test/                         # Vitest unit tests
├── dist/                         # Build output
└── manifest.json                 # Plugin manifest
```

## Development

### Prerequisites

- Node.js 18+ (recommend 22+)
- pnpm 10+
- An Obsidian test vault

### Setup

```bash
git clone https://github.com/GoBeromsu/Open-smart-connections.git
cd open-connections
pnpm install
```

### Development Commands

```bash
pnpm dev              # Vault selection + esbuild watch + hot reload
pnpm build            # Production build to dist/
pnpm test             # Run unit tests (Vitest)
pnpm test:watch       # Run tests in watch mode
pnpm lint             # ESLint check
pnpm lint:fix         # Auto-fix linting issues
pnpm typecheck        # TypeScript type checking
pnpm run ci           # Full CI pipeline (build + lint + test)
```

### Hot Reload

`pnpm dev` uses Obsidian's hot reload feature. After making changes:

1. The plugin rebuilds automatically (esbuild watch)
2. Your test vault reloads (if configured correctly)
3. Changes appear instantly without restarting Obsidian

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
4. Run `pnpm run ci` to verify your changes
5. Submit a pull request with a clear description

**Note:** This plugin maintains a shared architecture with other Obsidian plugins in the ecosystem. Large changes should be discussed in an issue first.

## Troubleshooting

### Plugin won't enable or crashes on startup

1. Check the Obsidian console (Ctrl+Shift+I / Cmd+Shift+I)
2. Verify you're on a supported Obsidian version (1.1.0+)
3. Try disabling other embedding-related plugins
4. Reinstall the plugin by deleting `.obsidian/plugins/open-connections/` and re-enabling from Community Plugins

### Embeddings slow or CPU-heavy (local Transformers.js)

1. Try a smaller model: `Xenova/bge-micro-v2` instead of `bge-m3`
2. Switch to an API provider if you have quota
3. Check if your browser supports WebGPU (Chrome/Edge on supported devices); otherwise WASM fallback is used

### API provider returns errors

1. Verify your API key is correct (check provider documentation)
2. Ensure you have API quota remaining
3. Check the Obsidian console for specific error messages
4. Try switching to a different provider temporarily to test

### Results don't look relevant

1. Embeddings quality depends on the model and your content
2. Try a different model (e.g., switch from `bge-micro-v2` to `bge-m3`)
3. Larger, higher-quality models generally give better results
4. Ensure your notes have sufficient content for the embedding model to work with

## License

**GNU General Public License v3.0** (GPL-3.0)

See [LICENSE](LICENSE) for details.

## Acknowledgments

This project is a fork of [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) by Brian Petro. It has been rebuilt from the ground up for stability, extensibility, and integration with the broader Obsidian plugin ecosystem.

Per GPL-3.0 Section 5, this modified version is clearly marked as different from the original.

## Links

- **Repository:** https://github.com/GoBeromsu/Open-smart-connections
- **Releases:** https://github.com/GoBeromsu/Open-smart-connections/releases
- **Issues:** https://github.com/GoBeromsu/Open-smart-connections/issues
- **Obsidian:** https://obsidian.md/
- **Smart Connections (Original):** https://smartconnections.app/

---

**Built with TypeScript · Powered by Transformers.js · Encrypted by Obsidian**
