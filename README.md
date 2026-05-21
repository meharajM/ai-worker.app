# AI-Worker 🎯

[![CI/CD](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml/badge.svg)](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Platform Support](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)

> **Voice-first desktop workspace with Model Context Protocol (MCP) integration**

AI-Worker is an intelligent desktop application that combines voice interaction with seamless MCP server integration. It enables you to interact with AI agents using natural voice commands while leveraging powerful AI tools and services through the Model Context Protocol.

## ✨ Features

- 🎤 **Voice-First Interface** - Control everything with voice commands
- 🔌 **MCP Integration** - Connect to Model Context Protocol servers for extended capabilities
- 🤖 **AI-Powered Workspace** - Built-in LLM support with Web-LLM for on-device inference
- 💬 **Multi-Platform Chat** - WhatsApp integration for seamless messaging
- 📱 **Cross-Platform** - Runs on macOS, Linux, and Windows
- 🚀 **High Performance** - Electron-based desktop app with TypeScript
- 🔐 **Privacy-Focused** - Local-first architecture with on-device processing
- 🎨 **Modern UI** - Built with React, TailwindCSS, and Radix UI
- 📊 **Advanced Browser Automation** - Playwright integration for web interactions
- 💾 **Persistent Storage** - SQLite database for local data persistence

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22.12.0 - [Install](https://nodejs.org/)
- **npm** or **yarn** - Comes with Node.js
- **Python 3** (Optional, for MCP servers) - [Install](https://www.python.org/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/meharajM/ai-worker.app.git
   cd ai-worker.app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup dependencies (MCP servers, Python, etc.)**
   ```bash
   # macOS / Linux
   ./scripts/setup-dependencies.sh
   
   # Windows (run PowerShell as Administrator)
   .\scripts\setup-dependencies.ps1
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Build for your platform**
   ```bash
   # macOS
   npm run build:mac
   
   # Linux
   npm run build:linux
   
   # Windows
   npm run build:win
   ```

## 📖 Documentation

### User Documentation
- [Installation Guide](docs/INSTALLATION.md) - Detailed setup instructions
- [User Guide](docs/USER_GUIDE.md) - How to use AI-Worker
- [MCP Integration](docs/MCP_GUIDE.md) - Setting up MCP servers

### Developer Documentation
- [Development Setup](docs/DEVELOPMENT.md) - Getting started with development
- [Architecture](docs/ARCHITECTURE.md) - System design and components
- [API Reference](docs/API.md) - Internal API documentation
- [Testing Guide](TESTING.md) - Running tests and E2E testing

## 🏗️ Development

### Basic Commands

```bash
# Start dev server with hot reload
npm run dev

# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run typecheck

# Build bundle
npm run build

# Run tests
npm run test:e2e          # Mock E2E tests
npm run test:mock         # UI mock tests
npm run test:speech       # Speech integration tests
npm run test:e2e:real     # Real E2E tests (requires API keys)

# Clean build artifacts
npm run clean
```

### Building & Publishing

```bash
# Build for Mac
npm run publish:mac
npm run publish:mac:universal

# Build for Linux
npm run publish:linux

# Build for Windows
npm run publish:win

# Build for all platforms
npm run publish:all
```

See [Publishing Guide](docs/PUBLISHING.md) for detailed release instructions.

## 🔌 MCP Server Integration

AI-Worker supports multiple MCP servers out of the box:

- **Memory Server** - Persistent memory management
- **Playwright Server** - Browser automation and web interactions
- **Custom Servers** - Easy integration of custom MCP servers

For setup instructions, see [MCP Integration Guide](docs/MCP_GUIDE.md).

## 📦 Project Structure

```
ai-worker.app/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Electron preload scripts
│   ├── renderer/      # React UI components
│   └── agents/        # AI agent implementations
├── tests/             # Test suites
├── scripts/           # Build and setup scripts
├── build/             # App icons and assets
└── docs/              # Documentation
```

## 🛠️ Tech Stack

- **Frontend**: React 18, TailwindCSS, Radix UI, Framer Motion
- **Desktop**: Electron 40, Electron Vite
- **Language**: TypeScript 5.3
- **Testing**: Playwright, E2E test suites
- **Build**: Electron Builder
- **AI/ML**: Web-LLM, Model Context Protocol
- **Database**: SQLite with better-sqlite3
- **Styling**: Lucide React icons, custom CSS

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

### Quick Contribution Steps

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and linting (`npm run lint:fix && npm run typecheck`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## 📋 Project Status

- **Current Version**: 0.1.2 (Beta)
- **Status**: Active Development
- **Next Milestones**: 
  - Enhanced voice recognition
  - Additional MCP server integrations
  - Mobile companion app

## 🐛 Known Issues & Roadmap

See [Issues](https://github.com/meharajM/ai-worker.app/issues) for known issues and [Projects](https://github.com/meharajM/ai-worker.app/projects) for our roadmap.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- UI components from [Radix UI](https://www.radix-ui.com/)
- Icons from [Lucide React](https://lucide.dev/)
- AI capabilities from [Web-LLM](https://webllm.mlc.ai/)
- Model Context Protocol by [Anthropic](https://modelcontextprotocol.io/)

## 💬 Community

- **GitHub Issues** - Report bugs or request features
- **GitHub Discussions** - Ask questions and share ideas
- **Email** - team@aiworker.app

## 🔗 Links

- **Website**: https://ai-worker.tech
- **Documentation**: https://ai-worker.tech/docs
- **GitHub**: https://github.com/meharajM/ai-worker.app
- **Issues**: https://github.com/meharajM/ai-worker.app/issues

---

<div align="center">
  Made with ❤️ by the AI-Worker Team
</div>
