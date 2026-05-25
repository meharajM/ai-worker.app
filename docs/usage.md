# AI-Worker Usage Guide

This guide explains the main workflows available in AI-Worker once the app is installed and running.

## Main Navigation

AI-Worker is organized into three primary areas:

- `Hub Chat` for prompts, sessions, and agent execution
- `MCP Connections` for connected tools and WhatsApp
- `Hub Settings` for providers, speech, memory, browser automation, and appearance

The home screen is chat-first and includes workflow starter tiles for common tasks.

![AI-Worker home screen](./screenshots/chat-home.png)

## Start a Chat Session

Use the message composer at the bottom of the screen to start a new task.

You can:

- type a request directly
- use the microphone button for voice input
- drag files into the composer
- use starter tiles to prefill common workflows

Typical prompts:

- summarize a folder of notes
- compare prices across multiple sites
- extract data from a document
- plan a trip or research task

## Use Workflow Tiles

The workflow tiles on the home screen are prompt accelerators. Clicking one injects a structured starter prompt into the chat input so you can modify it and send it immediately.

These tiles are useful when:

- you want a fast demo of the product
- you want a consistent prompt format
- you are exploring supported agent workflows

## Manage Sessions

The left sidebar stores recent sessions. Use it to:

- return to previous conversations
- separate different tasks into different sessions
- keep the workspace organized

The header also shows current status such as the active session and provider health.

## Configure Model Providers

Open `Hub Settings` -> `LLM Provider` to choose how AI-Worker answers prompts.

![LLM provider settings](./screenshots/settings-llm.png)

Supported provider paths in the current UI include:

- Ollama for local models
- OpenAI-compatible APIs
- Gemini
- Auto mode for provider selection
- on-device model paths where available

Recommended usage:

1. Configure at least one provider before relying on chat responses.
2. Use Ollama for local/offline experimentation.
3. Use hosted APIs when you need stronger external models or broader compatibility.

## Use Speech Recognition

Open `Hub Settings` -> `Speech Recognition` to manage offline speech input.

![Speech recognition settings](./screenshots/settings-voice.png)

Speech recognition details:

- uses local Vosk models
- works without a cloud speech service in the shown configuration
- can switch language model variants

Use this when:

- you want hands-free prompting
- you are testing voice-first workflows
- you prefer local speech recognition over remote services

## Manage MCP Connections

Open `MCP Connections` to see built-in and custom tool connections.

![MCP connections screen](./screenshots/mcp-connections.png)

The screen is used for:

- monitoring connected MCP services
- adding a new MCP connection
- enabling auto-connect behavior
- troubleshooting failing servers
- managing direct WhatsApp integration

Built-in services visible in the project include:

- `memory`
- `filesystem`
- `markitdown`
- internal Playwright browser automation

## Add a Custom MCP Server

From `MCP Connections`:

1. Click `Add Connection`.
2. Choose the server transport and command or URL details.
3. Save the configuration.
4. Connect the server and confirm the tools appear.

Use this path when you want AI-Worker to interact with additional local or remote MCP-compatible services.

## Use WhatsApp Integration

WhatsApp is surfaced directly in the connections area rather than as a separate MCP server.

Primary usage flow:

1. Open `MCP Connections`.
2. Click `Connect` in the WhatsApp section.
3. Scan the QR code.
4. Complete phone verification if prompted.
5. Return to chat and use WhatsApp-backed workflows as needed.

WhatsApp is especially relevant for:

- remote approvals
- phone-based notifications
- bidirectional messaging with the worker

## Browser Automation

AI-Worker includes browser automation support through Playwright-backed tooling.

The browser automation settings area is useful for:

- choosing the browser engine
- controlling headless behavior
- testing browser availability
- supporting web-navigation tasks initiated by the agent

Use browser automation when your workflow needs:

- page navigation
- form filling
- extraction from sites
- screenshot capture
- repetitive browser actions

## Memory and File Workflows

The current product shape includes internal memory and filesystem services. In practice, this supports workflows such as:

- reading and summarizing files
- keeping session context
- storing useful artifacts or derived information
- converting documents through MarkItDown

Use these capabilities for research, document extraction, and multi-step task execution.

## Recommended First Demo

For a quick product walkthrough:

1. Start the app and open `Hub Chat`.
2. Click one of the workflow tiles.
3. Configure an LLM provider in `Hub Settings` if none is active.
4. Open `MCP Connections` and confirm the default services are present.
5. Return to chat and run a small research or extraction task.

## Operational Notes

- If no LLM is configured, the header will show that state and chat results may not be available.
- Some MCP servers depend on external tools such as Python or `uv`.
- Browser-mode and Electron-mode capabilities can differ if the main shell is unavailable.

## Troubleshooting

### No LLM is active

Open `Hub Settings` -> `LLM Provider` and configure Ollama or a hosted provider.

### MCP tools are missing

Open `MCP Connections` and verify that the servers are connected and not reporting errors.

### Voice input is unavailable

Check the speech recognition settings and confirm the local Vosk model is selected correctly.

### Electron shell does not open during local development

If the renderer is still available at `http://localhost:5173`, you can continue validating UI flows there while debugging the Electron main process.

## Related Docs

- [Setup Guide](./setup.md)
