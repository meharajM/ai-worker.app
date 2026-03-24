#!/usr/bin/env bash
# =============================================================================
# publish-mac.sh — Mac Release Pipeline → Cloudflare R2
#
# Runs: lint → typecheck → build → package macOS → upload to R2
#
# Usage:
#   npm run publish:mac                        # arm64 (Apple Silicon)
#   npm run publish:mac:universal              # Universal (arm64 + x64)
#   npm run publish:mac -- --skip-checks       # Skip lint + typecheck
#   npm run publish:mac -- --skip-build        # Upload existing dist/ only
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.r2"

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

# ── Parse args ────────────────────────────────────────────────────────────────
BUILD_TARGET="arm64"
SKIP_CHECKS=false
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --universal)   BUILD_TARGET="universal" ;;
    --intel)       BUILD_TARGET="x64" ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-build)  SKIP_BUILD=true; SKIP_CHECKS=true ;;
  esac
done

# ── Confirmation prompt ───────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ⚠️   PRODUCTION RELEASE WARNING                     ║"
echo "║                                                      ║"
echo "║  Version : v${VERSION}                                   ║"
echo "║  Bucket  : ${R2_BUCKET_NAME}"
echo "║  Target  : macOS (${BUILD_TARGET})"
echo "║                                                      ║"
echo "║  Files will be IMMEDIATELY available to all users.  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
read -r -p "  Type 'yes' to confirm and publish to production: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo ""
  echo "❌ Aborted. Nothing was built or uploaded."
  exit 0
fi
echo ""

cd "$ROOT_DIR"

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

  echo ""
  echo "🍎 Packaging macOS (${BUILD_TARGET})..."
  npx electron-builder --mac "--${BUILD_TARGET}"

  echo ""
  echo "✅ macOS build complete."
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

echo "  → Uploading Mac binaries..."
aws s3 cp dist/ "${R2}/" --recursive --exclude "*" \
  --include "*.dmg" --include "*.zip" --include "*.blockmap" --include "*.yml" \
  $ENDPOINT

echo "  → Uploading install-mac.sh..."
aws s3 cp scripts/install-mac.sh "${R2}/install-mac.sh" $ENDPOINT

echo ""
echo "✅ Mac release v${VERSION} published to: ${R2_BUCKET_NAME}"
echo ""
echo "📋 Mac files in bucket:"
aws s3 ls "${R2}/" $ENDPOINT \
  | grep -E "\.(dmg|zip|blockmap|yml|sh)$" \
  | awk '{printf "   %-50s  %s\n", $4, $3}' \
  | sort
echo ""
