#!/usr/bin/env bash
# =============================================================================
# bootstrap-env.sh — Shared Environment Setup for AI-Worker Release Pipelines
# =============================================================================

set -euo pipefail

check_dependencies() {
  local needs_docker=$1
  local needs_wine=$2
  local host_os
  host_os="$(uname -s)"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  🚀 Bootstrapping Release Environment"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ "$host_os" = "Darwin" ]; then
    # 1. Homebrew (macOS only)
    if command -v brew > /dev/null 2>&1; then
      echo "✅ Homebrew is ready."
    else
      echo "🍺 Homebrew missing. Installing..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
  fi

  # 2. AWS CLI
  if command -v aws > /dev/null 2>&1; then
    echo "✅ AWS CLI detected."
  else
    if [ "$host_os" = "Darwin" ] && command -v brew > /dev/null 2>&1; then
      echo "☁️  AWS CLI missing. Installing via Homebrew..."
      brew install awscli
    elif [ "$host_os" = "Linux" ]; then
      if command -v apt-get > /dev/null 2>&1; then
        echo "☁️  AWS CLI missing. Installing via apt..."
        sudo apt-get update && sudo apt-get install -y awscli
      elif command -v dnf > /dev/null 2>&1; then
        echo "☁️  AWS CLI missing. Installing via dnf..."
        sudo dnf install -y awscli
      elif command -v yum > /dev/null 2>&1; then
        echo "☁️  AWS CLI missing. Installing via yum..."
        sudo yum install -y awscli
      else
        echo "⚠️  AWS CLI missing. Install it manually before publishing."
      fi
    else
      echo "⚠️  AWS CLI missing. Install it manually before publishing."
    fi
  fi

  # 3. Docker (Needed for Linux builds)
  if [ "$needs_docker" = true ]; then
    if [ -d "/Applications/Docker.app" ] || command -v docker > /dev/null 2>&1; then
      echo "✅ Docker Desktop detected."
    else
      if [ "$host_os" = "Darwin" ] && command -v brew > /dev/null 2>&1; then
        echo "🐳 Docker Desktop missing. Installing via Homebrew..."
        brew install --cask docker
      else
        echo "⚠️  Docker not detected. Install/start Docker manually for Linux packaging."
      fi
    fi

    # Start Docker daemon if not running (timeout 30s to avoid hanging)
    if ! docker info > /dev/null 2>&1; then
      if [ "$host_os" = "Darwin" ]; then
        echo "🐳 Docker daemon not running — launching Docker Desktop..."
        open -a Docker 2>/dev/null || true
      else
        echo "🐳 Docker daemon not running."
      fi
      echo "⏳ Waiting up to 30s for Docker daemon..."
      DOCKER_READY=false
      for i in {1..6}; do
        sleep 5
        if docker info > /dev/null 2>&1; then
          echo "✅ Docker is up!"
          DOCKER_READY=true
          break
        fi
        echo "   Still waiting... (${i}/6)"
      done
      if [ "$DOCKER_READY" = false ]; then
        echo "⚠️  Docker did not start in 30s. Linux builds may fail."
        echo "   Open Docker Desktop manually if needed."
      fi
    else
      echo "✅ Docker daemon is running."
    fi
  fi

  # 4. Wine (Optional)
  if [ "$needs_wine" = true ]; then
    if command -v wine > /dev/null 2>&1 || command -v wine64 > /dev/null 2>&1; then
       echo "✅ Wine detected."
    else
       echo "🍷 Wine not detected. electron-builder will use its own internal shim (skipping 1GB download)."
    fi
  fi

  # 5. FFMPEG (Optional - for WhatsApp media)
  if command -v ffmpeg > /dev/null 2>&1; then
    echo "✅ FFMPEG detected."
  else
    if [ "$host_os" = "Darwin" ] && command -v brew > /dev/null 2>&1; then
      echo "🎞️  FFMPEG missing. Installing via Homebrew..."
      brew install ffmpeg
    elif [ "$host_os" = "Linux" ]; then
      if command -v apt-get > /dev/null 2>&1; then
        echo "🎞️  FFMPEG missing. Installing via apt..."
        sudo apt-get update && sudo apt-get install -y ffmpeg
      elif command -v dnf > /dev/null 2>&1; then
        echo "🎞️  FFMPEG missing. Installing via dnf..."
        sudo dnf install -y ffmpeg
      elif command -v yum > /dev/null 2>&1; then
        echo "🎞️  FFMPEG missing. Installing via yum..."
        sudo yum install -y ffmpeg
      else
        echo "⚠️  FFMPEG missing. Install it manually if required."
      fi
    else
      echo "⚠️  FFMPEG missing. Install it manually if required."
    fi
  fi
}

resolve_required_node_version() {
  local root_dir="$1"
  local required
  required=$(cd "$root_dir" && node -p "(() => { const raw = require('./package.json').engines?.node || ''; const m = raw.match(/([0-9]+\.[0-9]+\.[0-9]+)/); return m ? m[1] : '22.12.0'; })()" 2>/dev/null || echo "22.12.0")
  echo "$required"
}

ensure_x64_node_runtime() {
  local root_dir="$1"
  local candidate="${X64_NODE_BIN:-node}"

  # Fast check: does the candidate node binary run under Rosetta/x64?
  if arch -x86_64 "$candidate" -e "process.exit(0)" > /dev/null 2>&1; then
    export X64_NODE_BIN="$candidate"
    return 0
  fi

  # Check if a previously-downloaded x64 node exists locally
  local required_version
  required_version=$(resolve_required_node_version "$root_dir")
  local install_dir="$HOME/.local/node-v${required_version}-darwin-x64"
  local local_node="${install_dir}/bin/node"

  if [ -x "$local_node" ] && arch -x86_64 "$local_node" -e "process.exit(0)" > /dev/null 2>&1; then
    export X64_NODE_BIN="$local_node"
    return 0
  fi

  # x64 Node not available — do NOT auto-download (blocks silently for minutes).
  # The caller will fall back to arm64 automatically.
  echo "   x64 Node unavailable (arch -x86_64 node failed)."
  echo "   Mac build will fall back to arm64."
  echo "   To enable universal builds: set X64_NODE_BIN=/path/to/x64/node"
  return 1
}
