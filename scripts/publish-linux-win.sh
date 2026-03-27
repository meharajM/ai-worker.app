#!/usr/bin/env bash
# =============================================================================
# publish-linux-win.sh — Linux & Windows Release Pipeline → Cloudflare R2
#
# Runs: lint → typecheck → build → package (Linux + Windows) → upload to R2
#
# Usage:
#   npm run publish:linux-win                        # Linux x64/arm64 + Windows x64
#   npm run publish:linux-win -- --linux-only        # Linux only
#   npm run publish:linux-win -- --win-only          # Windows only
#   npm run publish:linux-win -- --yes               # non-interactive confirmation
#   npm run publish:linux-win -- --skip-checks       # Skip lint + typecheck
#   npm run publish:linux-win -- --skip-build        # Upload existing dist/ only
#
# Requirements:
#   - Docker Desktop running (for Linux builds)
#   - .env.r2 in project root
#   - AWS CLI: brew install awscli
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.r2"
LINUX_OUT_DIR="dist/linux-release"
WIN_OUT_DIR="dist/win-release"

# ── Load R2 credentials ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Missing credentials file: .env.r2"
  echo "   cp .env.r2.example .env.r2  and fill in your credentials."
  exit 1
fi
# shellcheck source=/dev/null
set -a; source "$ENV_FILE"; set +a

: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set in .env.r2}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set in .env.r2}"
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME not set in .env.r2}"
: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL not set in .env.r2}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
export AWS_RETRY_MODE=adaptive
export AWS_MAX_ATTEMPTS=12

# ── Parse args ────────────────────────────────────────────────────────────────
BUILD_LINUX=true
BUILD_WIN=true
SKIP_CHECKS=false
SKIP_BUILD=false
AUTO_CONFIRM=false

for arg in "$@"; do
  case $arg in
    --linux-only)  BUILD_WIN=false ;;
    --win-only)    BUILD_LINUX=false ;;
    --yes|-y|--non-interactive) AUTO_CONFIRM=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-build)  SKIP_BUILD=true; SKIP_CHECKS=true ;;
  esac
done

# ── Confirmation prompt ───────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
TARGETS=""
[ "$BUILD_LINUX" = true ] && TARGETS="Linux (x64+arm64)"
[ "$BUILD_WIN" = true ]   && TARGETS="${TARGETS:+$TARGETS + }Windows (x64)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ⚠️   PRODUCTION RELEASE WARNING                     ║"
echo "║                                                      ║"
echo "║  Version : v${VERSION}                                   ║"
echo "║  Bucket  : ${R2_BUCKET_NAME}"
echo "║  Targets : ${TARGETS}"
echo "║                                                      ║"
echo "║  Files will be IMMEDIATELY available to all users.  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
if [ "$AUTO_CONFIRM" = false ]; then
  read -r -p "  Type 'yes' to confirm and publish to production: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo ""
    echo "❌ Aborted. Nothing was built or uploaded."
    exit 0
  fi
else
  echo "  Auto-confirm enabled (--yes). Continuing..."
fi
echo ""

cd "$ROOT_DIR"

# ── Pre-flight: Docker check ──────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ] && [ "$BUILD_LINUX" = true ]; then
  if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Start Docker Desktop to build Linux targets."
    echo "   Or run with --win-only to skip Linux builds."
    exit 1
  fi
fi

# ── Step 1: Quality checks ────────────────────────────────────────────────────
if [ "$SKIP_CHECKS" = false ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Step 1/3 — Quality Checks"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "🔍 Linting..."
  npm run lint

  echo ""
  echo "🔍 Type checking..."
  npm run typecheck

  echo ""
  echo "✅ Quality checks passed."
fi

# ── Step 2: Build + Package ───────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Step 2/3 — Build & Package"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "🔧 Fixing libsignal package name..."
  npm run prebuild:electron

  echo ""
  echo "📦 Building JS/renderer bundle..."
  npm run build

  if [ "$BUILD_LINUX" = true ]; then
    echo ""
    echo "🐧 Packaging Linux (x64 + arm64, via Docker)..."
    rm -rf "${LINUX_OUT_DIR}"
    mkdir -p "${LINUX_OUT_DIR}"
    npx electron-builder --linux --x64 --arm64 --config.directories.output="${LINUX_OUT_DIR}"
  fi

  if [ "$BUILD_WIN" = true ]; then
    echo ""
    echo "🪟 Packaging Windows (x64)..."
    rm -rf "${WIN_OUT_DIR}"
    mkdir -p "${WIN_OUT_DIR}"
    npx electron-builder --win --x64 --config.directories.output="${WIN_OUT_DIR}"
  fi

  echo ""
  echo "✅ Build complete."
else
  echo "⏭️  Skipping build — uploading existing dist/ folder."
fi

# ── Step 3: Upload to R2 ──────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 3/3 — Upload to Cloudflare R2"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

R2="s3://${R2_BUCKET_NAME}"
ENDPOINT="--endpoint-url ${R2_ENDPOINT_URL}"

retry_aws_cp() {
  local src="$1"
  local dst="$2"
  local max_attempts=5
  local attempt=1
  local backoff=5

  until aws s3 cp "$src" "$dst" $ENDPOINT --no-progress; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "❌ Upload failed after ${max_attempts} attempts: ${src}"
      return 1
    fi
    echo "⚠️ Upload failed (attempt ${attempt}/${max_attempts}): ${src}"
    echo "   Retrying in ${backoff}s..."
    sleep "$backoff"
    attempt=$((attempt + 1))
    backoff=$((backoff * 2))
  done
}

upload_artifacts() {
  local source_dir="$1"
  shift
  local pattern
  local file
  local found=false

  shopt -s nullglob
  for pattern in "$@"; do
    for file in "${source_dir}"/${pattern}; do
      found=true
      retry_aws_cp "$file" "${R2}/$(basename "$file")"
    done
  done
  shopt -u nullglob

  if [ "$found" = false ]; then
    echo "⚠️ No artifacts matched in ${source_dir} for patterns: $*"
    return 1
  fi
}

if [ "$BUILD_LINUX" = true ] || [ "$SKIP_BUILD" = true ]; then
  LINUX_UPLOAD_DIR="${LINUX_OUT_DIR}"
  if [ "$SKIP_BUILD" = true ] && [ ! -d "${LINUX_UPLOAD_DIR}" ]; then
    LINUX_UPLOAD_DIR="dist"
  fi

  echo "  → Uploading Linux binaries..."
  upload_artifacts "${LINUX_UPLOAD_DIR}" "*.AppImage" "*.deb" "*.blockmap" "latest*.yml"

  echo "  → Uploading install-linux.sh..."
  retry_aws_cp "scripts/install-linux.sh" "${R2}/install-linux.sh"
fi

if [ "$BUILD_WIN" = true ] || [ "$SKIP_BUILD" = true ]; then
  WIN_UPLOAD_DIR="${WIN_OUT_DIR}"
  if [ "$SKIP_BUILD" = true ] && [ ! -d "${WIN_UPLOAD_DIR}" ]; then
    WIN_UPLOAD_DIR="dist"
  fi

  echo "  → Uploading Windows binaries..."
  upload_artifacts "${WIN_UPLOAD_DIR}" "*.exe" "*.blockmap" "latest*.yml"

  echo "  → Uploading install-windows.ps1..."
  retry_aws_cp "scripts/install-windows.ps1" "${R2}/install-windows.ps1"
fi

echo ""
echo "✅ Linux/Win release v${VERSION} published to: ${R2_BUCKET_NAME}"
echo ""
echo "📋 Linux/Win files in bucket:"
aws s3 ls "${R2}/" $ENDPOINT \
  | grep -E "\.(exe|AppImage|deb|blockmap|yml|sh|ps1)$" \
  | awk '{printf "   %-50s  %s\n", $4, $3}' \
  | sort
echo ""
