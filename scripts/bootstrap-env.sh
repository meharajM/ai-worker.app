#!/usr/bin/env bash
# =============================================================================
# bootstrap-env.sh — Shared Environment Setup for AI-Worker Release Pipelines
# =============================================================================

set -euo pipefail

check_dependencies() {
  local needs_docker=$1
  local needs_wine=$2

  echo "🔍 Verifying release environment..."

  # 1. Homebrew
  if ! command -v brew >/dev/null 2>&1; then
    echo "🍺 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  # 2. AWS CLI
  if ! command -v aws >/dev/null 2>&1; then
    echo "☁️  Installing AWS CLI (for R2 upload)..."
    brew install awscli
  fi

  # 3. Docker (Needed for Linux builds)
  if [ "$needs_docker" = true ]; then
    if [ ! -d "/Applications/Docker.app" ]; then
      echo "🐳 Docker Desktop is missing or broken. Installing/Repairing..."
      brew uninstall --cask docker --force 2>/dev/null || true
      brew install --cask docker
    fi

    # Start Docker if closed
    if ! docker info >/dev/null 2>&1; then
      echo "🐳 Starting Docker Desktop..."
      open -a Docker
      echo "⏳ Waiting for Docker to be ready (this may take a minute)..."
      for i in {1..120}; do
        if docker info >/dev/null 2>&1; then
          echo "✅ Docker is up!"
          break
        fi
        if [ $i -eq 120 ]; then
          echo "❌ Docker failed to start. Please open it manually and try again."
          exit 1
        fi
        echo -n "."
        sleep 5
      done
    fi
  fi

  # 4. Wine (Optional but recommended for Windows builds)
  if [ "$needs_wine" = true ]; then
    if ! command -v wine >/dev/null 2>&1; then
       echo "🍷 Installing Wine (for Windows NSIS packaging)..."
       brew install --cask wine-stable || echo "⚠️ Wine failed to install. Continuing anyway; electron-builder might use its own internal shim."
    fi
  fi
}
