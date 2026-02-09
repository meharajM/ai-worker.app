# Setup Scripts

This directory contains automated setup scripts to install dependencies required for AI Worker's MCP servers.

## What Gets Installed

These scripts install:
- **Node.js** - Required for the app and some MCP servers
- **Python 3** - Required for MarkItDown and other Python-based MCP servers
- **uv** - Fast Python package runner for MCP servers

## Usage

### macOS / Linux

```bash
cd /path/to/ai-worker-app
./scripts/setup-dependencies.sh
```

### Windows

1. **Right-click PowerShell** and select **"Run as Administrator"**
2. Run the script:
   ```powershell
   cd C:\path\to\ai-worker-app
   .\scripts\setup-dependencies.ps1
   ```

## What the Scripts Do

### macOS (`setup-dependencies.sh`)
- Installs Homebrew (if not present)
- Installs Node.js via Homebrew
- Installs Python 3 via Homebrew
- Installs uv via official installer

### Linux (`setup-dependencies.sh`)
- Detects package manager (apt, yum, or dnf)
- Installs Node.js (uses NodeSource for latest version on Debian/Ubuntu)
- Installs Python 3 and pip
- Installs uv via official installer

### Windows (`setup-dependencies.ps1`)
- Installs Chocolatey (Windows package manager)
- Installs Node.js via Chocolatey
- Installs Python 3 via Chocolatey
- Installs uv via official installer
- **Requires Administrator privileges**

## After Installation

1. **Restart your terminal** (or source your shell config)
2. **Restart the AI Worker app**
3. **Enable MCP servers** in Settings → MCP Servers
4. **Test it out** by asking the AI to convert a document!

## Manual Installation

If you prefer to install manually or the script doesn't work for your system:

- **Node.js**: https://nodejs.org
- **Python**: https://www.python.org
- **uv**: https://astral.sh/uv

## Troubleshooting

**"Command not found" after installation**
- Restart your terminal/PowerShell
- On macOS/Linux: Run `source ~/.bashrc` or `source ~/.zshrc`
- On Windows: Close and reopen PowerShell

**Windows: "Execution policy" error**
- Run PowerShell as Administrator
- Run: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Linux: Permission denied**
- Make the script executable: `chmod +x scripts/setup-dependencies.sh`
- Run with: `./scripts/setup-dependencies.sh`
