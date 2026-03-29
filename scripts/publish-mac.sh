#!/usr/bin/env bash
# =============================================================================
# publish-mac.sh — Mac Release Pipeline → Cloudflare R2
#
# Runs: lint → typecheck → build → package macOS → upload to R2
#
# Usage:
#   npm run publish:mac                        # arm64 (Apple Silicon)
#   npm run publish:mac:universal              # Universal (arm64 + x64)
#   npm run publish:mac -- --universal --strict-universal  # force true universal
#   npm run publish:mac -- --yes               # non-interactive confirmation
#   npm run publish:mac -- --skip-checks       # Skip lint + typecheck
#   npm run publish:mac -- --skip-build        # Upload existing dist/ only
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.r2"
MAC_OUT_DIR="dist/mac-release"

# ── Load shared helpers ───────────────────────────────────────────────────────
source "$SCRIPT_DIR/bootstrap-env.sh"

clean_mac_universal_temps() {
  local out_dir="$1"
  echo "🧹 Cleaning stale mac universal temp artifacts in ${out_dir}..."
  rm -rf \
    "${out_dir}/mac-universal" \
    "${out_dir}/mac-universal-x64-temp" \
    "${out_dir}/mac-universal-arm64-temp" \
    dist/mac-universal \
    dist/mac-universal-x64-temp \
    dist/mac-universal-arm64-temp
  echo "✅ mac universal temp artifacts cleaned."
}

auto_clean_native_build_outputs() {
  echo "🧹 Cleaning native module build outputs..."
  rm -rf \
    node_modules/better-sqlite3/build \
    node_modules/bufferutil/build \
    node_modules/utf-8-validate/build
  echo "✅ Native build outputs cleaned."
}

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
BUILD_TARGET="arm64"
SKIP_CHECKS=false
SKIP_BUILD=false
STRICT_UNIVERSAL=false
AUTO_CONFIRM=false

for arg in "$@"; do
  case $arg in
    --universal)   BUILD_TARGET="universal" ;;
    --intel)       BUILD_TARGET="x64" ;;
    --strict-universal) STRICT_UNIVERSAL=true ;;
    --yes|-y|--non-interactive) AUTO_CONFIRM=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-build)  SKIP_BUILD=true; SKIP_CHECKS=true ;;
  esac
done

if [ "$BUILD_TARGET" = "universal" ] && [ "$(uname -m)" = "arm64" ]; then
  if ! ensure_x64_node_runtime "$ROOT_DIR"; then
    if [ "$STRICT_UNIVERSAL" = true ]; then
      echo "❌ Mac universal build requires an x64 Node runtime on Apple Silicon."
      echo "   Check failed: arch -x86_64 ${X64_NODE_BIN:-node} -e \"process.exit(0)\""
      echo "   Use --strict-universal only after x64 Node is available."
      exit 1
    fi

    echo "⚠️  x64 Node/Rosetta execution is unavailable on this host."
    echo "   Falling back target from universal → arm64 (compatibility mode)."
    echo "   Use --strict-universal to fail instead of fallback."
    BUILD_TARGET="arm64"
  fi
fi

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
  rm -rf "${MAC_OUT_DIR}"
  mkdir -p "${MAC_OUT_DIR}"
  if [ "$BUILD_TARGET" = "universal" ]; then
    auto_clean_native_build_outputs
    clean_mac_universal_temps "$MAC_OUT_DIR"
  fi
  npx electron-builder --mac "--${BUILD_TARGET}" --config.directories.output="${MAC_OUT_DIR}"

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

echo "  → Uploading Mac binaries..."
UPLOAD_DIR="${MAC_OUT_DIR}"
if [ "$SKIP_BUILD" = true ] && [ ! -d "${UPLOAD_DIR}" ]; then
  UPLOAD_DIR="dist"
fi

upload_artifacts "${UPLOAD_DIR}" "*.dmg" "*.zip" "*.blockmap" "latest*.yml"

echo "  → Uploading install-mac.sh..."
retry_aws_cp "scripts/install-mac.sh" "${R2}/install-mac.sh"

echo ""
echo "✅ Mac release v${VERSION} published to: ${R2_BUCKET_NAME}"
echo ""
echo "📋 Mac files in bucket:"
aws s3 ls "${R2}/" $ENDPOINT \
  | grep -E "\.(dmg|zip|blockmap|yml|sh)$" \
  | awk '{printf "   %-50s  %s\n", $4, $3}' \
  | sort
echo ""
