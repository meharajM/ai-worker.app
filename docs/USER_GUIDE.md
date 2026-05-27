# User Guide 📖

AI-Worker is a local-first intelligent assistant workspace that runs directly on your desktop. It integrates seamlessly with external tools using the Model Context Protocol (MCP) and automates tasks directly on your computer.

---

## 🧭 Workspace Overview

The Hub Chat view is the default workspace. Use the left sidebar to move between chat, MCP connections, and settings. The center prompt cards are ready-made workflows for common agent tasks, while the bottom composer accepts text, files, workspace folders, voice input, and visible browser-run controls.

![AI-Worker hub chat](screenshots/ai-worker-hub-chat.png)

### MCP Connections

Use the MCP Connections view to inspect configured tool servers, check connection status, and add new integrations.

![AI-Worker MCP connections](screenshots/ai-worker-mcp-connections.png)

### Hub Settings

Use Hub Settings to configure model providers, speech recognition, memory, browser automation, appearance, auditing, and feature flags.

![AI-Worker hub settings](screenshots/ai-worker-hub-settings.png)

### Command Palette

Press `Cmd+K` or `Ctrl+K` to open the command palette for navigation and quick actions.

![AI-Worker command palette](screenshots/ai-worker-command-palette.png)

---

## 🎤 Speech Input

AI-Worker allows you to command your workspace using natural speech.

### How it works
1. **Push-to-Talk / Wake word**: Tap the microphone icon or use the designated hotkey to start recording.
2. **Local Speech Recognition**: Your voice input is processed on-device using a lightweight local voice model (Vosk-browser) to guarantee privacy.
3. **Intent Recognition**: The transcription is processed by the underlying language model to determine the action to take.

### Sample Voice Commands
- *"Search the web for the latest updates on TypeScript 5.4"*
- *"Summarize the contents of the files in my workspace"*
- *"Open a browser and navigate to the GitHub repository"*
- *"Draft a response to the latest message on WhatsApp"*

---

## 🤖 AI Models (Local vs. Cloud)

You can choose where your AI processing runs depending on your resource constraints and privacy needs.

### 1. Local-First Processing (Web-LLM)
AI-Worker utilizes **Web-LLM** for running models directly in your browser/renderer process using web GPU acceleration:
- Runs models on-device (e.g., Llama 3, Phi 3, Gemma).
- No API keys required.
- Zero network requests leave your machine.
- Requires a compatible GPU (Apple Silicon, modern NVIDIA/AMD GPU).

### 2. Cloud API Connections
If you prefer larger LLMs or lack GPU hardware:
- Configure **OpenAI** or other cloud LLM API keys in the Settings panel.
- Fast processing speeds and high-reasoning capabilities.

---

## 💬 WhatsApp Integration

AI-Worker includes a built-in messenger bridge powered by Baileys.

### Setting up WhatsApp
1. Open **MCP Connections** or click **Connect WhatsApp** from the Hub Chat view.
2. Scan the generated QR code using your WhatsApp mobile app (Linked Devices).
3. Once authenticated, the agent can interact with your chat list, read incoming notifications, and execute text generation drafts.

---

## 💾 Local Session & Storage

- All conversations, configuration profiles, and browser actions are stored locally in an embedded **SQLite** database.
- Settings, prompt histories, and server connections are saved locally using **electron-store**.
- Sensitive information (such as API keys) is secured on-device using local OS keyring bindings.
