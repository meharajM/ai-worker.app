#!/usr/bin/env bash
# AI-Worker Linux Installer
# Auto-detects CPU architecture and downloads the matching .AppImage from Cloudflare R2.

set -e

R2_BASE="https://downloads.ai-worker.tech"
INSTALL_DIR="${HOME}/.local/bin"
APP_NAME="AI-Worker"

echo "🚀 AI-Worker Linux Installer"

# ── Detect architecture ────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)          ARCH_LABEL="x64" ;;
  aarch64|arm64)   ARCH_LABEL="arm64" ;;
  *)
    echo "❌ Unsupported architecture: $ARCH"
    echo "   AI-Worker supports x86_64 and aarch64 (ARM64)."
    exit 1
    ;;
esac
echo "🖥  Detected architecture: ${ARCH} → using ${ARCH_LABEL} build"

echo "Fetching latest version info..."

# ── Parse the manifest for the arch-specific AppImage ─────────────────────
# x64 manifests usually point to AI-Worker-<ver>.AppImage (no "x64" suffix),
# while arm64 often includes "-arm64". So we cannot rely on filename labels.
if [ "$ARCH_LABEL" = "arm64" ]; then
  MANIFEST_CANDIDATES=("latest-linux-arm64.yml" "latest-linux.yml")
else
  MANIFEST_CANDIDATES=("latest-linux.yml")
fi

APPIMAGE_FILE=""
MANIFEST_NAME_USED=""

for MANIFEST_NAME in "${MANIFEST_CANDIDATES[@]}"; do
  if ! MANIFEST=$(curl -fsSL "${R2_BASE}/${MANIFEST_NAME}" 2>/dev/null); then
    continue
  fi

  CANDIDATES=$(echo "$MANIFEST" \
    | grep -E '(^path:|url:)[[:space:]]*.*\.AppImage([[:space:]]|$)' \
    | sed -E 's/^[[:space:]-]*path:[[:space:]]*//; s/^[[:space:]-]*url:[[:space:]]*//' \
    | tr -d "\"'" \
    | tr -d '\r')

  if [ -z "$CANDIDATES" ]; then
    continue
  fi

  if [ "$ARCH_LABEL" = "arm64" ]; then
    APPIMAGE_FILE=$(echo "$CANDIDATES" | grep -E 'arm64' | head -n1 || true)
  else
    APPIMAGE_FILE=$(echo "$CANDIDATES" | grep -Ev 'arm64' | head -n1 || true)
  fi

  if [ -n "$APPIMAGE_FILE" ]; then
    MANIFEST_NAME_USED="$MANIFEST_NAME"
    break
  fi
done

if [ -z "$APPIMAGE_FILE" ]; then
  echo "❌ Could not find a ${ARCH_LABEL} AppImage in the latest release manifest."
  echo "   Checked manifests: ${MANIFEST_CANDIDATES[*]}"
  echo "   Please try again after the next release is published."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/${APP_NAME}.AppImage"

if [[ "$APPIMAGE_FILE" =~ ^https?:// ]]; then
  DOWNLOAD_URL="$APPIMAGE_FILE"
else
  DOWNLOAD_URL="${R2_BASE}/${APPIMAGE_FILE}"
fi

echo "📦 Downloading ${APPIMAGE_FILE} (from ${MANIFEST_NAME_USED})..."
curl -fL --progress-bar "${DOWNLOAD_URL}" -o "${DEST}"

echo "🔐 Setting executable permissions..."
chmod +x "${DEST}"

echo ""
echo "✅ AI-Worker (${ARCH_LABEL}) installed to ${DEST}"
echo "🎉 Launching AI-Worker..."
"${DEST}" &
