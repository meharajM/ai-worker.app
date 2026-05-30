# AI-Worker 🎯

[![CI/CD](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml/badge.svg)](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Platform Support](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**AI-Worker** is a **voice-first desktop agent workspace** built on the **Model Context Protocol (MCP)**. A unified hub for chat, files, browser automation, voice commands, and local-first LLM workflows — everything stays on your machine and under your control.

> *Most AI tools stop at chat. AI-Worker is built around the next step: connecting the assistant to useful local capabilities while keeping the workspace understandable, inspectable, and desktop-native.*

---

## ✨ Why AI-Worker?

Unlike browser-based AI tools or cloud-dependent agents:

- **🎤 Voice-First** — Push-to-talk speech input with offline recognition (Vosk). Hands-free, privacy-first interactions.
- **🏠 Desktop-Native** — Built with Electron. Works offline, integrates with your local files, no API dependency.
- **🔌 Extensible via MCP** — Model Context Protocol integration for memory, filesystem, browser automation, and custom tools.
- **🌐 Local AI Ready** — On-device model execution with WebGPU acceleration. Bring your own LLM (OpenAI, Gemini, Ollama, OpenRouter).
- **⚡ Agent Orchestration** — Coordinate research, document extraction, file work, browser tasks, and WhatsApp workflows from one app.
- **🔒 Security & Control** — Electron sandboxing, validated IPC, no external services required.

---

## 🎬 Screenshots

### Hub Chat — Voice & Text Workspace
![AI-Worker hub chat](./docs/screenshots/chat-home.png)

### MCP Connections — Extensible Tool Ecosystem  
![AI-Worker MCP connections](./docs/screenshots/mcp-connections.png)

### LLM Provider Settings — Multi-Model Support
![AI-Worker hub settings](./docs/screenshots/settings-llm.png)

### Speech Recognition Settings — Voice Configuration
![AI-Worker speech settings](./docs/screenshots/settings-voice.png)

---

## 🎯 Core Features

### Desktop Chat Workspace
- Text and voice input (speech-to-text with Vosk)
- File drag-and-drop for context
- Workflow starter tiles for common tasks
- Rich conversation history with semantic search

### Model Context Protocol (MCP) Integration
- Built-in MCP clients for stdio and SSE connections
- Pre-configured servers: memory, filesystem, MarkItDown, browser automation
- Easy integration of custom MCP servers
- Real-time connection status and debugging

### LLM Provider Flexibility
- **OpenAI** — GPT-4, GPT-3.5
- **Gemini** — Full API support
- **Ollama** — Local model hosting
- **OpenRouter** — 100+ models on one API
- **Web-LLM** — On-device WebGPU execution
- Auto-mode for intelligent provider routing

### Voice & Speech Recognition
- **Push-to-talk microphone** — Click to record, auto-detect end
- **Offline Vosk** — Private speech recognition, no cloud dependency
- **Voice command routing** — Intent detection for hands-free workflows

### Browser Automation
- **Playwright-backed** — Full web automation (click, type, extract, screenshot)
- **Secure sandboxing** — Isolated browser context
- **Form filling & navigation** — Automate data entry and research workflows

### WhatsApp Integration  
- Direct phone messaging via Baileys library
- Approval workflows ("ask for permission via WhatsApp")
- Multi-user task delegation

### Native Cross-Platform Packaging
- **macOS** — Universal (Intel + Apple Silicon)
- **Linux** — AppImage and deb support
- **Windows** — EXE installer

---

## 🛠️ Architecture: The Three Engineering Paradigms

AI-Worker is engineered around three foundational pillars for modern agentic systems:

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI-Worker Architecture                     │
├───────────────────┬──────────────────────┬──────────────────────┤
│ Prompt Engineering │ Context Engineering  │  Harness Engineering │
│                   │                      │                      │
│ ∙ System Intent   │ ∙ Semantic Memory    │ ∙ Browser Sandboxing │
│ ∙ On-Device LLMs  │ ∙ Context Pruning    │ ∙ Secure IPC Bridges │
│ ∙ Tool Validation │ ∙ MCP Server Binding │ ∙ WhatsApp Gateway   │
└───────────────────┴──────────────────────┴──────────────────────┘
```

### 1. Prompt Engineering
- **System Instruction Alignment** — Structured prompts enforcing tool-use validation
- **On-Device Inference** — WebGPU-accelerated local model execution
- **Dynamic Templates** — Real-time variable injection for user directives and tool outputs

### 2. Context Engineering
- **Semantic Memory** — Persistent entity & relationship database (MCP server-backed)
- **Context Pruning** — Algorithmic token reduction preserving workspace metadata
- **Multi-Source Fusion** — Unified context from files, browser state, terminal sessions, and memory

### 3. Harness & Tool Engineering
- **Playwright Browser Harness** — Secure web automation for extraction, forms, navigation
- **Process Isolation** — Electron sandbox + validated IPC boundaries
- **Communication Bridges** — Baileys/WhatsApp integration for approval workflows

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22.12.0 — [Install Node.js](https://nodejs.org/)
- **npm** — Included with Node.js
- **Python 3** + **uv** — For Python-based MCP servers (optional but recommended)

### Installation & Running (5 Steps)

**1. Clone the repository**
```bash
git clone https://github.com/meharajM/ai-worker.app.git
cd ai-worker.app
```

**2. Install dependencies**
```bash
npm install
```

**3. Bootstrap MCP and system dependencies**

**For macOS & Linux:**
```bash
chmod +x ./scripts/setup-dependencies.sh
./scripts/setup-dependencies.sh
```

**For Windows (run PowerShell as Administrator):**
```powershell
.\\scripts\\setup-dependencies.ps1
```

**4. Start development server**
```bash
npm run dev
```

The app opens at `http://localhost:5173` with hot-reload. If Electron shell fails, the renderer is still available at that address.

**5. Build native installers (optional)**

```bash
# macOS (Intel + Apple Silicon)
npm run build:mac

# Linux  
npm run build:linux

# Windows
npm run build:win
```

For detailed setup help, see **[Setup Guide](./docs/setup.md)**.

---

## 📖 Usage & Configuration

### First Launch

1. Start in **Hub Chat** — Type or use voice input
2. Go to **Hub Settings** → **LLM Providers** → Choose your model source (OpenAI, Ollama, etc.)
3. Configure **MCP Connections** — Inspect built-in tools or add custom servers
4. (Optional) Enable **Speech Settings** → Configure Vosk or cloud speech services

The default local setup includes:
- Internal semantic memory (local SQLite)
- Filesystem access and watching
- MarkItDown document parsing
- Playwright-backed browser automation

### Comprehensive Guides

- **[Setup Guide](./docs/setup.md)** — Environment configuration, dependencies, troubleshooting
- **[Usage Guide](./docs/usage.md)** — Voice controls, provider setup, MCP configuration, workflows
- **[MCP Integration](./docs/MCP_GUIDE.md)** — Build and connect custom MCP servers
- **[Docs Index](./docs/README.md)** — Full documentation map

---

## 🔧 Command Reference

```bash
# Development
npm run dev              # Start dev server with hot-reload (HMR)
npm run dev:clean       # Clear cache and cold-start dev

# Quality & Validation  
npm run lint            # Check code style (ESLint)
npm run lint:fix        # Auto-fix linting issues
npm run typecheck       # Verify TypeScript compilation
npm run build           # Build Electron app
npm run test:mock       # Run mocked E2E tests

# Production
npm run build:mac       # Build macOS universal binary
npm run build:linux     # Build Linux AppImage
npm run build:win       # Build Windows installer
npm run publish:all     # Publish to Cloudflare R2
```

For full command docs, see **[Scripts README](./scripts/README.md)**.

---

## 📂 Project Structure

```
ai-worker.app/
├── src/
│   ├── main/                # Electron backend, native drivers, SQLite  
│   ├── preload/             # IPC security bridges (isolated context)
│   ├── renderer/            # React UI and local LLM controllers
│   └── renderer/src/lib/agent/  # Intent analysis, orchestration, tool execution
├── docs/                    # Guides, architecture, screenshots, proposals
├── tests/                   # Playwright E2E tests, mocks, validation
├── scripts/                 # Platform-specific setup and build scripts
└── build/                   # Package assets (icons, splashscreens)
```

---

## 🤝 Contributing

We love contributions! Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)** to understand our process.

### Quick Links

- **[Bug Report](https://github.com/meharajM/ai-worker.app/issues/new?template=bug_report.md)** — Found an issue?
- **[Feature Request](https://github.com/meharajM/ai-worker.app/issues/new?template=feature_request.md)** — Have an idea?
- **[Security Policy](./SECURITY.md)** — Report vulnerabilities responsibly
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** — Community standards

### How to Help

- **Contribute code** — See good-first-issues or open a discussion
- **Improve docs** — Setup guides, tutorials, examples
- **Build MCP servers** — Extend capabilities via protocol
- **Provider integrations** — Add new LLM providers or speech backends
- **Share workflows** — Post use cases in Discussions

---

## 📊 Project Status

**AI-Worker is early-stage open-source software.**

    ✅ **Production-ready:**
- Electron app with native packaging (macOS, Linux, Windows)
- React renderer UI with hot-reload
- MCP connection surface and configuration
- LLM provider settings and routing
- Speech recognition setup
- Browser automation via Playwright
- Release and publishing scripts

⚠️ **In development:**
- Hardening for first-time contributors
- Dependency audit and security triaging
- GitHub repository settings review

**Known:** If Electron shell fails during development, the renderer is available at `http://localhost:5173`.

---

## 🌟 Show Your Support

Help other builders discover AI-Worker:

- **⭐ Star the repository** — Boosts GitHub search ranking
- **🔗 Share** — Link to this repo with developers working on AI agents, browser automation, voice interfaces, or local-first workflows
- **💬 Join Discussions** — Share your workflows, questions, and examples
- **🐛 Open Issues** — Report bugs or request features
- **📝 Contribute** — Code, docs, examples, integrations

---

## 📄 License

AI-Worker is open-source software licensed under the **[MIT License](LICENSE)**.

---

## 📞 Get in Touch

- **Homepage:** https://ai-worker.tech
- **GitHub:** https://github.com/meharajM/ai-worker.app
- **Author:** AI-Worker Team <team@aiworker.app>

---

*Built with ❤️ for developers and power users who want to reclaim control of their AI workflows.*
