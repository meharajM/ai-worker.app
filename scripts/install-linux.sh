#!/usr/bin/env bash
# AI-Worker Linux Installer
# Auto-detects CPU architecture and downloads the matching .AppImage from Cloudflare R2.

set -e

R2_BASE="https://downloads.aiworker.app"
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
# electron-builder lists all files in the yaml; we grep for the right one.
MANIFEST=$(curl -fsSL "${R2_BASE}/latest-linux.yml")
APPIMAGE_FILE=$(echo "$MANIFEST" | grep -E "\.AppImage" | grep "${ARCH_LABEL}" | grep -E '^[[:space:]]*url:' | head -n1 | awk '{print $2}' | tr -d '[:space:]')

# Fallback: try the top-level path: field if url: pattern didn't match
if [ -z "$APPIMAGE_FILE" ]; then
  APPIMAGE_FILE=$(echo "$MANIFEST" | grep -E "^path:.*${ARCH_LABEL}.*AppImage" | head -n1 | awk '{print $2}' | tr -d '[:space:]')
fi

if [ -z "$APPIMAGE_FILE" ]; then
  echo "❌ Could not find a ${ARCH_LABEL} AppImage in the latest release manifest."
  echo "   Please try again after the next release is published."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/${APP_NAME}.AppImage"

echo "📦 Downloading ${APPIMAGE_FILE}..."
curl -fL --progress-bar "${R2_BASE}/${APPIMAGE_FILE}" -o "${DEST}"

echo "🔐 Setting executable permissions..."
chmod +x "${DEST}"

echo ""
echo "✅ AI-Worker (${ARCH_LABEL}) installed to ${DEST}"
echo "🎉 Launching AI-Worker..."
"${DEST}" &
