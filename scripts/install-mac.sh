#!/usr/bin/env bash
# AI-Worker macOS Installer
# Downloads the latest build from Cloudflare R2 and installs it to /Applications.
# Run this script to install AI-Worker without requiring an Apple developer certificate.

set -e

R2_BASE="https://downloads.ai-worker.tech"
TMP_DIR="$(mktemp -d)"
APP_NAME="AI-Worker"
INSTALL_DIR="/Applications"

echo "🚀 AI-Worker Installer"
echo "Fetching latest version info..."

# Download the latest-mac.yml manifest to find the exact DMG filename.
# electron-builder format example: "  - url: AI-Worker-0.1.0-universal.dmg"
# The top-level path: points to the .zip (auto-updater), so we find the .dmg from the files list.
MANIFEST=$(curl -fsSL "${R2_BASE}/latest-mac.yml")
DMG_FILE=$(echo "$MANIFEST" | grep '\.dmg' | grep 'url:' | awk '{print $NF}' | tr -d '[:space:]')

if [ -z "$DMG_FILE" ]; then
  echo "❌ Could not find a .dmg file in the latest release manifest."
  exit 1
fi

echo "📦 Downloading ${DMG_FILE}..."
curl -fL --progress-bar "${R2_BASE}/${DMG_FILE}" -o "${TMP_DIR}/${DMG_FILE}"

echo "💿 Mounting disk image..."
# hdiutil columns use multiple spaces; the /Volumes/ path may also contain spaces.
# Strip everything before /Volumes/ to reliably extract the full mount path.
# Notice we DO NOT use -quiet, as -quiet completely silences output in scripts.
MOUNT_OUTPUT=$(hdiutil attach "${TMP_DIR}/${DMG_FILE}" -nobrowse 2>&1)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep '/Volumes/' | sed 's|.*/Volumes/|/Volumes/|' | sed 's/[[:space:]]*$//')

if [ -z "$MOUNT_POINT" ]; then
  echo "❌ Failed to mount the disk image."
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "📂 Installing ${APP_NAME}.app to ${INSTALL_DIR}..."
# Remove previous install if it exists
if [ -d "${INSTALL_DIR}/${APP_NAME}.app" ]; then
  rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
fi
cp -a "${MOUNT_POINT}/${APP_NAME}.app" "${INSTALL_DIR}/"

# Strip the quarantine attribute so Gatekeeper does not block the app
xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true

echo "🔌 Unmounting disk image..."
hdiutil detach "$MOUNT_POINT" -quiet

echo "🧹 Cleaning up..."
rm -rf "$TMP_DIR"

echo ""
echo "✅ AI-Worker has been installed to ${INSTALL_DIR}/${APP_NAME}.app"
echo "🎉 Launching AI-Worker..."
open "${INSTALL_DIR}/${APP_NAME}.app"
