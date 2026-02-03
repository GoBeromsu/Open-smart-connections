<h2 align="center">
Talk to your notes without leaving Obsidian
</h2>

> [!QUESTION] **Why juggle browser tabs?**
> Chat directly inside your vault with context-aware responses.

> [!WARNING] **The Problem**
> Switching between the browser and Obsidian breaks your flow and scatters conversations.

# Smart Chat (Obsidian Plugin)

Smart Chat adds a powerful chat interface to Obsidian using the [Smart Environment](https://github.com/brianpetro/jsbrains/tree/main/smart-environment) architecture. It allows you to chat with an AI model while dynamically pulling context from your Obsidian vault, creating new chat threads, injecting context or system prompts, and more.

✔️ Context-aware responses from your vault

🔐 Private & local-first by default

🤖 Works with local models like Ollama

## How It Works

Smart Chat uses several underlying modules that work together:

- **smart-environment**  
	The main runtime harness. It initializes modules, loads settings, and provides the app-wide `env` (environment).

- **smart-collections**  
	A flexible data-layer for storing items (like threads and completions). It handles loading/saving, item relationships, and queue-based file operations.

- **smart-completions**  
	A module that represents each AI request (prompt) and AI response as a 'SmartCompletion' item. Adapters automatically transform data before sending it to the AI (for example, inserting context or system messages).

- **smart-chat-model**  
	A multi-adapter approach for hooking up to different AI chat providers (e.g., OpenAI, Anthropic, etc.). You choose which service to use via plugin settings.

- **smart-actions**, **smart-contexts**, **smart-sources**  
	Additional modules that handle tool calls (actions), context retrieval, and knowledge sources, respectively.

### Plugin Architecture

When you enable Smart Chat in Obsidian:

1. **`main.js`**  
	 - The main plugin entry point. It sets up the environment (`SmartEnv.create`) and merges its own `smart_env_config` with any from `./dist/smart_env.config.js`.
	 - Registers a custom view called "smart-chat-view," which displays the chat UI.

2. **`build_smart_env_config.js`**  
	 - Scans `./src` for collections, items, and components.
	 - Generates `./dist/smart_env.config.js`, which tells the environment what to load and how.

3. **`src/collections/smart_chat_threads.js`**  
	 - A collection to store chat threads. Each thread can have multiple completions.
	 - Threads define settings (like which AI model to use).

4. **`src/items/smart_chat_thread.js`**  
	 - Each chat thread is an item representing the conversation, messages, and references to user/system prompts.

5. **`src/components/`**  
	 - Modular UI components for chat layout, messages, context review, etc.  
	 - Each file has a `build_html(...)` and `render(...)` method. The environment calls these to produce the DOM.

6. **`smart_chat.obsidian.js`**  
	 - Implements `SmartChatView`, which extends Obsidian's `ItemView` class. This is the right-hand side panel that displays the chat interface.

### Data Flow

1. **User types a new message** in the input box.
2. **A SmartCompletion** is created or updated for the conversation:
	 - The plugin runs adapters (system, user, context, thread, etc.) to build an OpenAI-like request.
	 - The chat model (like openai or anthropic) is called with that request.
	 - The response is saved in the `completion.responses` array.
3. **The UI** updates to show the new messages and any context selection overlays.

### Files You May Want to Explore

- `main.js`  
	Entry point for the plugin. Registers the chat view and merges environment configs.

- `src/chat.html`  
	A static HTML reference for testing the chat UI in a browser environment without Obsidian.

- `src/components/*`  
	Each sub-component for the chat UI: user messages, assistant replies, context selection, etc.

- `src/items/*`  
	Data classes representing key objects in the plugin: `SmartChatThread` and `SmartAction`.

- `src/actions/lookup_context.js`  
	An example "action" that the AI can call to retrieve relevant notes from your vault.

### Building and Installing

1. **Install Dependencies**  
	 Run `npm install` in the `smart-chat-obsidian` directory. This plugin references local dependencies like `smart-collections` and `smart-completions`, so ensure they are linked or otherwise accessible.

2. **Build**  
	 Run `npm run build`. This does two steps:
	 - `node build_smart_env_config.js` (scans for items/components)
	 - `node esbuild.js` (or your own bundler script)

3. **Copy to Your Obsidian Vault's Plugins**  
	 Copy the resulting `main.js`, `manifest.json`, and `styles.css` into a folder under `.obsidian/plugins/smart-chat/` in your vault.

4. **Enable**  
	 In Obsidian settings, go to 'Community plugins' and enable 'Smart Chat'.

### Usage

- Open the ribbon icon titled 'Open: Smart Chat' or open the 'Smart Chat' view from the right sidebar.
- Type a message into the input box at the bottom of the chat panel.
- Optionally, click 'Edit system message' to add instructions for the AI (like "You are an expert note-taking assistant").
- Use '@' in the input to open a context selection modal, letting you pick notes from your vault to include in the prompt. The plugin dynamically retrieves relevant text from your notes.

### Settings

- In Obsidian settings, you will find a 'Smart Chat' tab:
	- **Language**: Sets the language used in the chat model or how self-referential detection is done.
	- **Detect Self-Referential**: If enabled, certain user messages auto-trigger a context lookup.
	- **Review Context**: If enabled, an in-between step appears to let you select or deselect notes that were auto-retrieved before sending them to the AI.

### Adapters at a Glance

- **System Adapter**  
	Injects your 'system_message' into the request.
- **User Adapter**  
	Adds the user's message into the request.
- **Context Adapter**  
	Pulls in text from 'smart_contexts' if 'context_key' is set.
- **Thread Adapter**  
	Gathers previous messages in the thread so the model sees the entire conversation.
- **Action Adapter**  
	If the model calls a function (tool call), it routes that to a 'SmartAction' in your environment.

### Development Tips

- For advanced debugging, open the developer console in Obsidian (Ctrl+Shift+I on many systems).
- The plugin logs diagnostic info to the console, such as how it compiles ephemeral context and sets up actions.
- If you want to update the code and test quickly, run the build script again and re-load the plugin in Obsidian.

## Built for You

> Smart Chat started as a personal tool to keep conversations and context together. The Obsidian community has helped shape it into a flexible interface for local-first AI workflows.

## FAQs & Troubleshooting

### How do I use Smart Chat with Open WebUI (Ollama)?
Set the `path` setting to `api/chat/completions` in **Settings → Smart Chat → Path**.