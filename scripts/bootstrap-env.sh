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
