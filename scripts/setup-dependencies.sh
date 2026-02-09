#!/bin/bash
# AI Worker - Dependency Setup Script
# This script installs Node.js, Python, and uv for MCP server support

set -e  # Exit on error

echo "🚀 AI Worker - Setting up dependencies..."
echo ""

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM=Linux;;
    Darwin*)    PLATFORM=Mac;;
    *)          PLATFORM="UNKNOWN:${OS}"
esac

echo "📍 Detected platform: $PLATFORM"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to install on macOS
install_mac() {
    echo "🍎 Installing dependencies for macOS..."
    echo ""
    
    # Check for Homebrew
    if ! command_exists brew; then
        echo "📦 Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    else
        echo "✅ Homebrew already installed"
    fi
    
    # Install Node.js
    if ! command_exists node; then
        echo "📦 Installing Node.js..."
        brew install node
    else
        echo "✅ Node.js already installed ($(node --version))"
    fi
    
    # Install Python
    if ! command_exists python3; then
        echo "📦 Installing Python 3..."
        brew install python
    else
        echo "✅ Python 3 already installed ($(python3 --version))"
    fi
    
    # Install uv
    if ! command_exists uv; then
        echo "📦 Installing uv (Python package runner)..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        
        # Add to PATH for current session
        export PATH="$HOME/.cargo/bin:$PATH"
    else
        echo "✅ uv already installed ($(uv --version))"
    fi
}

# Function to install on Linux
install_linux() {
    echo "🐧 Installing dependencies for Linux..."
    echo ""
    
    # Detect package manager
    if command_exists apt-get; then
        PKG_MANAGER="apt-get"
        INSTALL_CMD="sudo apt-get install -y"
    elif command_exists yum; then
        PKG_MANAGER="yum"
        INSTALL_CMD="sudo yum install -y"
    elif command_exists dnf; then
        PKG_MANAGER="dnf"
        INSTALL_CMD="sudo dnf install -y"
    else
        echo "❌ Could not detect package manager (apt, yum, or dnf)"
        exit 1
    fi
    
    echo "📦 Using package manager: $PKG_MANAGER"
    
    # Install Node.js
    if ! command_exists node; then
        echo "📦 Installing Node.js..."
        if [ "$PKG_MANAGER" = "apt-get" ]; then
            # Use NodeSource for latest Node.js on Debian/Ubuntu
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            $INSTALL_CMD nodejs
        else
            $INSTALL_CMD nodejs
        fi
    else
        echo "✅ Node.js already installed ($(node --version))"
    fi
    
    # Install Python
    if ! command_exists python3; then
        echo "📦 Installing Python 3..."
        $INSTALL_CMD python3 python3-pip
    else
        echo "✅ Python 3 already installed ($(python3 --version))"
    fi
    
    # Install uv
    if ! command_exists uv; then
        echo "📦 Installing uv (Python package runner)..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        
        # Add to PATH for current session
        export PATH="$HOME/.cargo/bin:$PATH"
    else
        echo "✅ uv already installed ($(uv --version))"
    fi
}

# Main installation logic
case "${PLATFORM}" in
    Mac)
        install_mac
        ;;
    Linux)
        install_linux
        ;;
    *)
        echo "❌ Unsupported platform: ${PLATFORM}"
        echo "Please install Node.js, Python 3, and uv manually:"
        echo "  - Node.js: https://nodejs.org"
        echo "  - Python: https://www.python.org"
        echo "  - uv: https://astral.sh/uv"
        exit 1
        ;;
esac

echo ""
echo "✅ All dependencies installed successfully!"
echo ""
echo "📝 Next steps:"
echo "  1. Restart your terminal (or run: source ~/.bashrc or source ~/.zshrc)"
echo "  2. Restart the AI Worker app"
echo "  3. Enable MarkItDown in Settings → MCP Servers"
echo ""
echo "🎉 You're all set!"
