#!/usr/bin/env bash
# =============================================================================
# publish-all.sh — Full Release Pipeline (All Platforms → Cloudflare R2)
#
# Defaults:
#   - Mac: universal (arm64 + x64)
#   - Linux: x64 + arm64
#   - Windows: x64
#
# Usage:
#   npm run publish:all                         # Mac universal + Linux + Windows (fallback if universal unavailable)
#   npm run publish:all -- --mac-only           # Mac universal only
#   npm run publish:all -- --mac-only --arm64   # Mac arm64 only
#   npm run publish:all -- --mac-only --intel   # Mac x64 only
#   npm run publish:all -- --mac-only --universal --strict-universal  # force true universal
#   npm run publish:all -- --allow-mac-fallback # allow universal -> arm64 fallback
#   npm run publish:all -- --yes                # non-interactive confirmation
#   npm run publish:all -- --linux-only         # Linux only
#   npm run publish:all -- --win-only           # Windows only
#   npm run publish:all -- --skip-checks        # Skip lint + typecheck
#   npm run publish:all -- --skip-build         # Upload existing dist/ only
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env.r2"
DIST_ROOT="dist"
MAC_OUT_DIR="${DIST_ROOT}/mac-release"
LINUX_OUT_DIR="${DIST_ROOT}/linux-release"
WIN_OUT_DIR="${DIST_ROOT}/win-release"

# ── Load shared helper ───────────────────────────────────────────────────────
source "$SCRIPT_DIR/bootstrap-env.sh"

auto_clean_native_build_outputs() {
  echo "🧹 Cleaning native module build outputs..."
  rm -rf \
    node_modules/better-sqlite3/build \
    node_modules/bufferutil/build \
    node_modules/utf-8-validate/build
  echo "✅ Native build outputs cleaned."
}

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

reset_output_dir() {
  local out_dir="$1"
  rm -rf "${out_dir}"
  mkdir -p "${out_dir}"
}

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

upload_latest_manifests() {
  local source_dir="$1"
  if [ -d "$source_dir" ]; then
    local manifest
    local found=false
    shopt -s nullglob
    for manifest in "${source_dir}"/latest*.yml; do
      found=true
      retry_aws_cp "$manifest" "${R2}/$(basename "$manifest")"
    done
    shopt -u nullglob

    if [ "$found" = false ]; then
      echo "⚠️ No updater manifests found in ${source_dir}."
    fi
  fi
}

# ── Load R2 credentials ───────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Missing credentials file: .env.r2"
  echo "   cp .env.r2.example .env.r2  and fill in your credentials."
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# ── Parse args ────────────────────────────────────────────────────────────────
BUILD_MAC=true; BUILD_LINUX=true; BUILD_WIN=true
SKIP_CHECKS=false; SKIP_BUILD=false; MAC_ARCH="universal"; STRICT_UNIVERSAL=false; AUTO_CONFIRM=false

for arg in "$@"; do
  case $arg in
    --mac-only)   BUILD_LINUX=false; BUILD_WIN=false ;;
    --linux-only) BUILD_MAC=false; BUILD_WIN=false ;;
    --win-only)   BUILD_MAC=false; BUILD_LINUX=false ;;
    --arm64)      MAC_ARCH="arm64" ;;
    --intel)      MAC_ARCH="x64" ;;
    --universal)  MAC_ARCH="universal" ;;
    --strict-universal) STRICT_UNIVERSAL=true ;;
    --allow-mac-fallback) STRICT_UNIVERSAL=false ;;
    --yes|-y|--non-interactive) AUTO_CONFIRM=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --skip-build)  SKIP_BUILD=true; SKIP_CHECKS=true ;;
  esac
done

# Universal mac builds require a viable x64 Node runtime/toolchain path.
# Default mode is compatibility fallback with a clear warning.
# Use --strict-universal to enforce true universal output.
if [ "$BUILD_MAC" = true ] && [ "$MAC_ARCH" = "universal" ] && [ "$(uname -m)" = "arm64" ]; then
  if ! ensure_x64_node_runtime "$ROOT_DIR"; then
    if [ "$STRICT_UNIVERSAL" = true ]; then
      echo "❌ Mac universal build requires an x64 Node runtime on Apple Silicon."
      echo "   Check failed: arch -x86_64 ${X64_NODE_BIN:-node} -e \"process.exit(0)\""
      echo ""
      echo "   Setup (local machine):"
      echo "   1) /usr/sbin/softwareupdate --install-rosetta --agree-to-license"
      echo "   2) Export X64_NODE_BIN to a working x64 Node path"
      echo "   3) Re-run with --strict-universal"
      echo ""
      echo "   Alternative: provide explicit x64 node path:"
      echo "   X64_NODE_BIN=/absolute/path/to/x64/node npm run publish:all -- --mac-only --universal --strict-universal"
      exit 1
    fi

    echo "⚠️  x64 Node/Rosetta execution is unavailable on this host."
    echo "   Falling back Mac target from universal → arm64 (compatibility mode)."
    echo ""
    echo "   Universal build did not run."
    echo "   To force universal and fail if unavailable:"
    echo "   npm run publish:all -- --mac-only --universal --strict-universal --yes"
    echo ""
    echo "   If you have a custom x64 Node binary:"
    echo "   X64_NODE_BIN=/absolute/path/to/x64/node npm run publish:all -- --mac-only --universal --strict-universal --yes"
    MAC_ARCH="arm64"
  fi
fi

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
if [ "$AUTO_CONFIRM" = false ]; then
  read -r -p "  Type 'yes' to confirm and publish to production: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Aborted."
    exit 0
  fi
else
  echo "  Auto-confirm enabled (--yes). Continuing..."
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
export AWS_RETRY_MODE=adaptive
export AWS_MAX_ATTEMPTS=12

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
  [ "$BUILD_MAC" = true ]   && (
    echo "🍎 Packaging Mac (${MAC_ARCH})..."
    reset_output_dir "$MAC_OUT_DIR"
    if [ "$MAC_ARCH" = "universal" ]; then
      auto_clean_native_build_outputs
      clean_mac_universal_temps "$MAC_OUT_DIR"
      npx electron-builder --mac --${MAC_ARCH} --config.directories.output="${MAC_OUT_DIR}"
    else
      npx electron-builder --mac --${MAC_ARCH} --config.directories.output="${MAC_OUT_DIR}"
    fi
  )
  [ "$BUILD_LINUX" = true ] && (
    echo "🐧 Packaging Linux (Docker)..."
    reset_output_dir "$LINUX_OUT_DIR"
    npx electron-builder --linux --x64 --arm64 --config.directories.output="${LINUX_OUT_DIR}"
  )
  [ "$BUILD_WIN" = true ]   && (
    echo "🪟 Packaging Windows..."
    reset_output_dir "$WIN_OUT_DIR"
    npx electron-builder --win --x64 --config.directories.output="${WIN_OUT_DIR}"
  )
fi

# ── Step 4: Upload to R2 ──────────────────────────────────────────────────────
echo "☁️  [4/4] Uploading to Cloudflare R2..."
R2="s3://${R2_BUCKET_NAME}"
ENDPOINT="--endpoint-url ${R2_ENDPOINT_URL}"
UPLOAD_PIDS=()
MAC_UPLOAD_DIR="$MAC_OUT_DIR"
LINUX_UPLOAD_DIR="$LINUX_OUT_DIR"
WIN_UPLOAD_DIR="$WIN_OUT_DIR"

# Backward-compatible fallback for --skip-build on older dist layouts
if [ "$SKIP_BUILD" = true ]; then
  [ -d "$MAC_UPLOAD_DIR" ] || MAC_UPLOAD_DIR="$DIST_ROOT"
  [ -d "$LINUX_UPLOAD_DIR" ] || LINUX_UPLOAD_DIR="$DIST_ROOT"
  [ -d "$WIN_UPLOAD_DIR" ] || WIN_UPLOAD_DIR="$DIST_ROOT"
fi

# Keep packaging sequential (safer for native rebuild state), but upload in parallel.
# Upload jobs are independent (different file globs + installer scripts), so this
# parallelism speeds publish without risking build artifact corruption.

[ "$BUILD_MAC" = true ] && (
  upload_artifacts "${MAC_UPLOAD_DIR}" "*.dmg" "*.zip" "*.blockmap"
  retry_aws_cp "scripts/install-mac.sh" "${R2}/install-mac.sh"
) &
[ "$BUILD_MAC" = true ] && UPLOAD_PIDS+=($!)

[ "$BUILD_LINUX" = true ] && (
  upload_artifacts "${LINUX_UPLOAD_DIR}" "*.AppImage" "*.deb" "*.blockmap"
  retry_aws_cp "scripts/install-linux.sh" "${R2}/install-linux.sh"
) &
[ "$BUILD_LINUX" = true ] && UPLOAD_PIDS+=($!)

[ "$BUILD_WIN" = true ] && (
  upload_artifacts "${WIN_UPLOAD_DIR}" "*-Setup-*.exe" "*-Setup-*.exe.blockmap"
  retry_aws_cp "scripts/install-windows.ps1" "${R2}/install-windows.ps1"
) &
[ "$BUILD_WIN" = true ] && UPLOAD_PIDS+=($!)

# Wait for all upload jobs and fail if any job failed
for pid in "${UPLOAD_PIDS[@]}"; do
  wait "$pid"
done

# Sync updater manifests from each platform output
[ "$BUILD_MAC" = true ] && upload_latest_manifests "$MAC_UPLOAD_DIR"
[ "$BUILD_LINUX" = true ] && upload_latest_manifests "$LINUX_UPLOAD_DIR"
[ "$BUILD_WIN" = true ] && upload_latest_manifests "$WIN_UPLOAD_DIR"

echo "✅ Done! Release v${VERSION} is now live."
