# Installation Guide 🎯

This guide provides step-by-step instructions to install and configure AI-Worker on your local machine.

## Prerequisites

Before installing, ensure your environment meets these version requirements:

- **Node.js** ≥ `22.12.0` (LTS recommended)
- **npm** ≥ `10.0.0` or **yarn** / **pnpm**
- **Git** installed on your system
- **Python 3** (Optional: required for running Python-based MCP servers)

---

## 🚀 Quick Start (All Platforms)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/meharajM/ai-worker.app.git
   cd ai-worker.app
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Bootstrap MCP and Local Dependencies:**
   - **macOS / Linux:**
     ```bash
     chmod +x ./scripts/setup-dependencies.sh
     ./scripts/setup-dependencies.sh
     ```
   - **Windows:**
     Run PowerShell as Administrator:
     ```powershell
     .\scripts\setup-dependencies.ps1
     ```

4. **Start the application in Development Mode:**
   ```bash
   npm run dev
   ```

---

## 💻 Platform-Specific Instructions

### macOS Installation

1. **Prerequisites**: Install Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```
2. **Build the Application**:
   - Universal binary (both Apple Silicon & Intel):
     ```bash
     npm run build:mac:universal
     ```
   - Apple Silicon (M1/M2/M3) only:
     ```bash
     npm run build:mac:arm
     ```
   - Intel Mac only:
     ```bash
     npm run build:mac:intel
     ```
3. The packaged app will be available under the `dist/` directory as a DMG and ZIP.

### Linux Installation

1. **Build Dependencies**: Ensure you have basic build tools (gcc, g++, make):
   ```bash
   # Debian/Ubuntu
   sudo apt-get update
   sudo apt-get install -y build-essential libasound2-dev
   ```
2. **Build the Application**:
   ```bash
   npm run build:linux
   ```
3. The build outputs `AppImage` and `deb` installers in the `dist/` directory.

### Windows Installation

1. **Build Prerequisites**:
   - Run PowerShell as Administrator and run the preflight checks script:
     ```powershell
     .\scripts\setup-dependencies.ps1
     ```
   - Ensure MSVC build tools or Python is installed if compiling native dependencies like `better-sqlite3`.
2. **Build the Application**:
   ```bash
   npm run build:win
   ```
3. The installer (`AI-Worker-Setup-*.exe`) will be generated in the `dist/` directory.

---

## 🛠️ Troubleshooting Installation Issues

### Native Module Compilation Failure
If you receive errors compiling `better-sqlite3`, clean the native build caches and run the build command again:
```bash
npm run clean:native:build
npm install
```

### Electron Prebuild Errors
Ensure your Node version is exactly `22.12.0` or higher:
```bash
node -v
```
Use `nvm` (Node Version Manager) to easily switch versions:
```bash
nvm install 22.12.0
nvm use 22.12.0
```
