#!/usr/bin/env bash
# =============================================================================
# publish-all.sh — Full Release Pipeline (All Platforms → Cloudflare R2)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.r2"

# ── Load shared helper ───────────────────────────────────────────────────────
source "$SCRIPT_DIR/bootstrap-env.sh"

# ── Load R2 credentials ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Missing credentials file: .env.r2"
  echo "   cp .env.r2.example .env.r2  and fill in your credentials."
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# ── Parse args ────────────────────────────────────────────────────────────────
BUILD_MAC=true; BUILD_LINUX=true; BUILD_WIN=true
SKIP_CHECKS=false; SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --mac-only)   BUILD_LINUX=false; BUILD_WIN=false ;;
    --linux-only) BUILD_MAC=false; BUILD_WIN=false ;;
    --win-only)   BUILD_MAC=false; BUILD_LINUX=false ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-build)  SKIP_BUILD=true; SKIP_CHECKS=true ;;
  esac
done

# ── Run Environment Bootstrapping ───────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  check_dependencies "$BUILD_LINUX" "$BUILD_WIN"
fi

# ── Confirmation prompt ───────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ⚠️   PRODUCTION RELEASE WARNING                     ║"
echo "║                                                      ║"
echo "║  Version : v${VERSION}                                   ║"
echo "║  Bucket  : ${R2_BUCKET_NAME}"
echo "║                                                      ║"
echo "║  Files will be IMMEDIATELY available to all users.  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
read -r -p "  Type 'yes' to confirm and publish to production: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Aborted."
  exit 0
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true

cd "$ROOT_DIR"

# ── Step 1: Quality checks ────────────────────────────────────────────────────
if [ "$SKIP_CHECKS" = false ]; then
  echo "🔍 [1/4] Running Quality Checks (Lint + Typecheck)..."
  npm run lint && npm run typecheck
fi

# ── Step 2: Build JS bundle ───────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "🔧 [2/4] Building JS bundle..."
  npm run prebuild:electron
  npm run build

# ── Step 3: Package all platforms ────────────────────────────────────────────
  echo "📦 [3/4] Packaging platforms..."
  [ "$BUILD_MAC" = true ]   && (echo "🍎 Packaging Mac..."; npx electron-builder --mac --arm64)
  [ "$BUILD_LINUX" = true ] && (echo "🐧 Packaging Linux (Docker)..."; npx electron-builder --linux --x64 --arm64)
  [ "$BUILD_WIN" = true ]   && (echo "🪟 Packaging Windows..."; npx electron-builder --win --x64)
fi

# ── Step 4: Upload to R2 ──────────────────────────────────────────────────────
echo "☁️  [4/4] Uploading to Cloudflare R2..."
R2="s3://${R2_BUCKET_NAME}"
ENDPOINT="--endpoint-url ${R2_ENDPOINT_URL}"

[ "$BUILD_MAC" = true ] && (
  aws s3 cp dist/ "${R2}/" --recursive --exclude "*" --include "*.dmg" --include "*.zip" --include "*.blockmap" --include "*.yml" $ENDPOINT
  aws s3 cp scripts/install-mac.sh "${R2}/install-mac.sh" $ENDPOINT
)

[ "$BUILD_LINUX" = true ] && (
  aws s3 cp dist/ "${R2}/" --recursive --exclude "*" --include "*.AppImage" --include "*.deb" --include "*.blockmap" --include "*.yml" $ENDPOINT
  aws s3 cp scripts/install-linux.sh "${R2}/install-linux.sh" $ENDPOINT
)

[ "$BUILD_WIN" = true ] && (
  aws s3 cp dist/ "${R2}/" --recursive --exclude "*" --include "*.exe" --include "*.blockmap" --include "*.yml" $ENDPOINT
  aws s3 cp scripts/install-windows.ps1 "${R2}/install-windows.ps1" $ENDPOINT
)

# Sync all manifests
aws s3 cp dist/ "${R2}/" --recursive --exclude "*" --include "*.yml" $ENDPOINT

echo "✅ Done! Release v${VERSION} is now live."
