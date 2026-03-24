#!/usr/bin/env bash
# AI-Worker Linux Installer
# Downloads the latest .AppImage build from Cloudflare R2,
# sets it as executable, and launches it.

set -e

R2_BASE="https://downloads.aiworker.app"
INSTALL_DIR="${HOME}/.local/bin"
APP_NAME="AI-Worker"

echo "🚀 AI-Worker Linux Installer"
echo "Fetching latest version info..."

# Download the latest-linux.yml manifest to find the exact AppImage filename
MANIFEST=$(curl -fsSL "${R2_BASE}/latest-linux.yml")
APPIMAGE_FILE=$(echo "$MANIFEST" | grep -E '^path:.*AppImage' | head -n1 | awk '{print $2}' | tr -d '[:space:]')

if [ -z "$APPIMAGE_FILE" ]; then
  echo "❌ Could not determine the latest build file. Please try again."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/${APP_NAME}.AppImage"

echo "📦 Downloading ${APPIMAGE_FILE}..."
curl -fL --progress-bar "${R2_BASE}/${APPIMAGE_FILE}" -o "${DEST}"

echo "🔐 Setting executable permissions..."
chmod +x "${DEST}"

echo ""
echo "✅ AI-Worker has been installed to ${DEST}"
echo "🎉 Launching AI-Worker..."
"${DEST}" &
