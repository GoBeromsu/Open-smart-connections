# Smart Connections (Community Fork)

An Obsidian plugin that uses local AI embeddings to find semantically related notes.

> This is a community-maintained fork of [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) by Brian Petro.

## Why This Fork?

The original Smart Connections has been an invaluable tool for the Obsidian community. However, starting from version 4.x, [several issues](https://github.com/brianpetro/obsidian-smart-connections/issues) have been reported that affect core functionality:

- Embedding model compatibility issues
- Configuration and settings problems
- Performance degradation in large vaults

This community fork aims to:
- **Maintain stability** for users who depend on Smart Connections daily
- **Fix critical bugs** that impact core functionality
- **Preserve the original vision** of a privacy-first, local-first semantic search tool

## Features

- **Zero-setup**: Local AI models for embeddings, no API key required
- **Private & offline**: Your data stays on your device
- **Mobile support**: Works on iOS and Android
- **Multiple model options**: Supports local models via Ollama, LM Studio, and HuggingFace transformers.js
- **Lightweight**: ~1 MB bundle with minimal dependencies

## Installation

### Manual Installation

1. Download the latest release from the [Releases](../../releases) page
2. Extract to your vault's `.obsidian/plugins/smart-connections/` directory
3. Enable the plugin in Obsidian Settings > Community Plugins

### From Source

```bash
git clone https://github.com/GoBeromsu/obsidian-smart-connections.git
cd obsidian-smart-connections
npm install
npm run build
```

Copy the `dist/` contents to your vault's plugin directory.

## Usage

1. Enable Smart Connections from Obsidian's Community Plugins
2. Open the Connections view (ribbon icon or command palette)
3. The plugin will automatically begin creating embeddings using a local model
4. View related notes as you navigate your vault

## Contributing

Contributions are welcome! Please:

1. Fork this repository
2. Create a feature branch
3. Submit a pull request with a clear description

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0), the same license as the original Smart Connections.

### Attribution

This is a modified version of [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) originally created by [Brian Petro](https://github.com/brianpetro).

- Original Copyright (C) Brian Petro
- Fork maintained by the community

Per GPL-3.0 Section 5, this modified version is clearly marked as different from the original.

## Links

- [Original Repository](https://github.com/brianpetro/obsidian-smart-connections)
- [Original Documentation](https://smartconnections.app/)
- [Obsidian](https://obsidian.md/)

---

*This fork is not affiliated with or endorsed by the original Smart Connections project.*
