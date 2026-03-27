#!/usr/bin/env bash
# =============================================================================
# bootstrap-env.sh — Shared Environment Setup for AI-Worker Release Pipelines
# =============================================================================

set -euo pipefail

check_dependencies() {
  local needs_docker=$1
  local needs_wine=$2

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  🚀 Bootstrapping Release Environment"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 1. Homebrew
  if command -v brew >/dev/null 2>&1; then
    echo "✅ Homebrew is ready."
  else
    echo "🍺 Homebrew missing. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  # 2. AWS CLI
  if command -v aws >/dev/null 2>&1; then
    echo "✅ AWS CLI detected."
  else
    echo "☁️  AWS CLI missing. Installing via Homebrew..."
    brew install awscli
  fi

  # 3. Docker (Needed for Linux builds)
  if [ "$needs_docker" = true ]; then
    if [ -d "/Applications/Docker.app" ] || command -v docker >/dev/null 2>&1; then
      echo "✅ Docker Desktop detected."
    else
      echo "🐳 Docker Desktop missing. Installing via Homebrew..."
      brew install --cask docker
    fi

    # Start Docker if closed
    if ! docker info >/dev/null 2>&1; then
      echo "🐳 Starting Docker Desktop..."
      open -a Docker
      echo "⏳ Waiting for Docker to be ready..."
      for i in {1..30}; do
        if docker info >/dev/null 2>&1; then
          echo "✅ Docker is up!"
          break
        fi
        echo -n "."
        sleep 5
      done
    fi
  fi

  # 4. Wine (Optional)
  if [ "$needs_wine" = true ]; then
    if command -v wine >/dev/null 2>&1 || command -v wine64 >/dev/null 2>&1; then
       echo "✅ Wine detected."
    else
       echo "🍷 Wine not detected. electron-builder will use its own internal shim (skipping 1GB download)."
    fi
  fi

  # 5. FFMPEG (Optional - for WhatsApp media)
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "✅ FFMPEG detected."
  else
    echo "🎞️  FFMPEG missing. Installing via Homebrew..."
    brew install ffmpeg
  fi
}

resolve_required_node_version() {
  local root_dir="$1"
  local required
  required=$(cd "$root_dir" && node -p "(() => { const raw = require('./package.json').engines?.node || ''; const m = raw.match(/([0-9]+\\.[0-9]+\\.[0-9]+)/); return m ? m[1] : '22.12.0'; })()" 2>/dev/null || echo "22.12.0")
  echo "$required"
}

ensure_x64_node_runtime() {
  local root_dir="$1"
  local candidate="${X64_NODE_BIN:-node}"

  if arch -x86_64 "$candidate" -e "process.exit(0)" >/dev/null 2>&1; then
    export X64_NODE_BIN="$candidate"
    return 0
  fi

  local required_version
  required_version=$(resolve_required_node_version "$root_dir")
  local install_dir="$HOME/.local/node-v${required_version}-darwin-x64"
  local local_node="${install_dir}/bin/node"

  if [ -x "$local_node" ] && arch -x86_64 "$local_node" -e "process.exit(0)" >/dev/null 2>&1; then
    export X64_NODE_BIN="$local_node"
    return 0
  fi

  echo "🔧 x64 Node runtime not found. Auto-installing Node v${required_version} (darwin-x64)..."
  mkdir -p "$HOME/.local"
  local tarball="node-v${required_version}-darwin-x64.tar.xz"
  local url="https://nodejs.org/dist/v${required_version}/${tarball}"
  local tmp_tar="/tmp/${tarball}"

  if ! curl -fL "$url" -o "$tmp_tar"; then
    echo "❌ Failed to download x64 Node from: $url"
    return 1
  fi

  rm -rf "$install_dir"
  mkdir -p "$install_dir"
  if ! tar -xJf "$tmp_tar" -C "$install_dir" --strip-components=1; then
    echo "❌ Failed to extract x64 Node archive: $tmp_tar"
    return 1
  fi

  if [ -x "$local_node" ] && arch -x86_64 "$local_node" -e "process.exit(0)" >/dev/null 2>&1; then
    export X64_NODE_BIN="$local_node"
    echo "✅ x64 Node ready: $X64_NODE_BIN"
    return 0
  fi

  echo "❌ x64 Node installed but failed runtime check: $local_node"
  return 1
}
