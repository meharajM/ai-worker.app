#!/bin/bash
# AI Worker - Dependency Setup Script
# This script installs Node.js, Python, uv, and Playwright browsers

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

# Function to check which browsers are available on the system
# Sets AVAILABLE_BROWSERS array and prints status for each
check_system_browsers() {
    echo "🔍 Checking for available browsers..."
    echo ""

    AVAILABLE_BROWSERS=()

    # Check for Google Chrome
    if command_exists google-chrome || command_exists google-chrome-stable \
        || [ -f "/usr/bin/google-chrome" ] || [ -f "/usr/bin/google-chrome-stable" ] \
        || [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
        AVAILABLE_BROWSERS+=("chrome")
        echo "  ✅ Google Chrome     - system install found (can use directly)"
    else
        echo "  ❌ Google Chrome     - not found on system"
    fi

    # Check for Microsoft Edge
    if command_exists microsoft-edge || [ -f "/usr/bin/microsoft-edge" ] \
        || [ -f "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
        AVAILABLE_BROWSERS+=("msedge")
        echo "  ✅ Microsoft Edge    - system install found (can use directly)"
    else
        echo "  ❌ Microsoft Edge    - not found on system"
    fi

    # Check for Firefox
    if command_exists firefox || [ -f "/usr/bin/firefox" ] \
        || [ -f "/Applications/Firefox.app/Contents/MacOS/firefox" ]; then
        AVAILABLE_BROWSERS+=("firefox")
        echo "  ✅ Mozilla Firefox   - system install found (Playwright will wrap it)"
    else
        echo "  ❌ Mozilla Firefox   - not found on system (Playwright will download it)"
    fi

    # Chromium is always available as bundled via Playwright
    AVAILABLE_BROWSERS+=("chromium")
    echo "  ✅ Chromium (bundled) - always available via Playwright download"

    echo ""
}

# Function to install a Playwright browser
# Returns 0 on success, 1 on failure — does NOT abort the script
install_playwright_browser() {
    local browser=$1

    echo "📦 Installing Playwright browser: $browser"

    if ! command_exists npx; then
        echo "❌ npx not found. Please install Node.js first."
        return 1
    fi

    case "$browser" in
        chrome)   npx playwright install chrome   ;;
        msedge)   npx playwright install msedge   ;;
        firefox)  npx playwright install firefox  ;;
        chromium) npx playwright install chromium ;;
        *)
            echo "❌ Unknown browser: $browser"
            return 1
            ;;
    esac

    echo "✅ $browser installed successfully"
}

# Function to save selected browser to electron-store so the app reads it on launch
save_selected_browser() {
    local browser=$1
    local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/ai-worker"
    mkdir -p "$config_dir"
    local store_file="$config_dir/ai-worker-store.json"

    if command_exists python3; then
        # Pass values via env vars to avoid shell-variable-in-single-quote expansion issues
        STORE_FILE="$store_file" BROWSER="$browser" python3 - << 'PYEOF'
import json, os

store_file = os.environ["STORE_FILE"]
browser    = os.environ["BROWSER"]

if os.path.exists(store_file):
    with open(store_file, "r") as f:
        data = json.load(f)
else:
    data = {}

if "mcpPlaywright" not in data:
    data["mcpPlaywright"] = {}
data["mcpPlaywright"]["browser"] = browser

with open(store_file, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
    else
        # python3 not available: write a minimal JSON file
        echo "{\"mcpPlaywright\":{\"browser\":\"$browser\"}}" > "$store_file"
    fi

    echo "💾 Browser preference saved: $browser"
}

# Function to prompt user for browser selection and install
prompt_browser_selection() {
    # First show what's on the system
    check_system_browsers

    echo "🌐 Which browser should AI Worker use for web automation?"
    echo ""

    # Build numbered menu from available browsers
    local i=1
    local menu_browsers=()
    for b in "${AVAILABLE_BROWSERS[@]}"; do
        case "$b" in
            chrome)   echo "  $i) Google Chrome      - use your system Chrome"  ;;
            msedge)   echo "  $i) Microsoft Edge     - use your system Edge"     ;;
            firefox)  echo "  $i) Mozilla Firefox   - Playwright-wrapped Firefox" ;;
            chromium) echo "  $i) Chromium (Bundled) - downloaded by Playwright (recommended on Linux)" ;;
        esac
        menu_browsers+=("$b")
        i=$((i + 1))
    done

    echo ""
    echo "Enter choice (1-$((i-1))) or press Enter for Chromium (recommended): "
    read -r choice

    # Default to chromium if empty input
    if [ -z "$choice" ]; then
        choice="$((${#menu_browsers[@]}))"  # chromium is always last
        # find chromium index
        for idx in "${!menu_browsers[@]}"; do
            if [ "${menu_browsers[$idx]}" = "chromium" ]; then
                choice=$((idx + 1))
                break
            fi
        done
    fi

    # Validate choice is a number in range
    if ! echo "$choice" | grep -qE '^[0-9]+$' || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#menu_browsers[@]}" ]; then
        echo "⚠️  Invalid choice. Defaulting to Chromium."
        SELECTED_BROWSER="chromium"
    else
        SELECTED_BROWSER="${menu_browsers[$((choice - 1))]}"
    fi

    echo ""
    echo "Installing $SELECTED_BROWSER via Playwright..."
    # Don't let a failed install abort the whole script
    if ! install_playwright_browser "$SELECTED_BROWSER"; then
        echo "⚠️  Installation failed for $SELECTED_BROWSER. Falling back to Chromium."
        SELECTED_BROWSER="chromium"
        install_playwright_browser "chromium" || true
    fi

    save_selected_browser "$SELECTED_BROWSER"
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

# Check if npx is available (needed for Playwright)
if command_exists npx; then
    echo ""
    echo "🎯 Base dependencies installed!"
    echo ""

    # Prompt for browser selection (skip in non-interactive mode)
    if [ -t 0 ]; then
        # Terminal is interactive — let user choose
        prompt_browser_selection
    else
        # Non-interactive (e.g. CI): install chromium by default and save preference
        echo "🔧 Running in non-interactive mode. Installing Chromium (bundled)..."
        install_playwright_browser "chromium" || true
        save_selected_browser "chromium"
    fi
else
    echo ""
    echo "⚠️  Node.js not found. Skipping Playwright browser installation."
    echo "   Run this script again after installing Node.js to install browsers."
fi

echo ""
echo "✅ All dependencies installed successfully!"
echo ""
echo "📝 Next steps:"
echo "  1. Restart your terminal (or run: source ~/.bashrc or source ~/.zshrc)"
echo "  2. Restart the AI Worker app"
echo "  3. Enable MarkItDown in Settings → MCP Servers"
echo ""
echo "🎉 You're all set!"
