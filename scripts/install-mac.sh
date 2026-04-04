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

# Download the latest-mac.yml manifest to find the preferred artifact.
# Prefer DMG when present, but fall back to ZIP so ZIP-only releases remain installable.
MANIFEST=$(curl -fsSL "${R2_BASE}/latest-mac.yml")
DMG_FILE=$(echo "$MANIFEST" | grep '\.dmg' | grep 'url:' | awk '{print $NF}' | tr -d '[:space:]')
ZIP_FILE=$(echo "$MANIFEST" | grep '\.zip' | grep 'url:' | head -n 1 | awk '{print $NF}' | tr -d '[:space:]')

if [ -z "$DMG_FILE" ] && [ -z "$ZIP_FILE" ]; then
  echo "❌ Could not find a macOS installer artifact in the latest release manifest."
  exit 1
fi

install_app_bundle() {
  local app_source="$1"
  echo "📂 Installing ${APP_NAME}.app to ${INSTALL_DIR}..."
  if [ -d "${INSTALL_DIR}/${APP_NAME}.app" ]; then
    rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
  fi
  cp -a "${app_source}" "${INSTALL_DIR}/"
  xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true
}

if [ -n "$DMG_FILE" ]; then
  echo "📦 Downloading ${DMG_FILE}..."
  curl -fL --progress-bar "${R2_BASE}/${DMG_FILE}" -o "${TMP_DIR}/${DMG_FILE}"

  echo "💿 Mounting disk image..."
  MOUNT_OUTPUT=$(hdiutil attach "${TMP_DIR}/${DMG_FILE}" -nobrowse 2>&1)
  MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep '/Volumes/' | sed 's|.*/Volumes/|/Volumes/|' | sed 's/[[:space:]]*$//')

  if [ -z "$MOUNT_POINT" ]; then
    echo "❌ Failed to mount the disk image."
    rm -rf "$TMP_DIR"
    exit 1
  fi

  install_app_bundle "${MOUNT_POINT}/${APP_NAME}.app"

  echo "🔌 Unmounting disk image..."
  hdiutil detach "$MOUNT_POINT" -quiet
else
  echo "📦 Downloading ${ZIP_FILE}..."
  curl -fL --progress-bar "${R2_BASE}/${ZIP_FILE}" -o "${TMP_DIR}/${ZIP_FILE}"

  echo "🗜️ Extracting archive..."
  unzip -q "${TMP_DIR}/${ZIP_FILE}" -d "${TMP_DIR}/unzipped"
  APP_BUNDLE=$(find "${TMP_DIR}/unzipped" -maxdepth 3 -type d -name "${APP_NAME}.app" | head -n 1)
  if [ -z "$APP_BUNDLE" ]; then
    echo "❌ Failed to locate ${APP_NAME}.app inside ZIP archive."
    rm -rf "$TMP_DIR"
    exit 1
  fi

  install_app_bundle "$APP_BUNDLE"
fi

echo "🧹 Cleaning up..."
rm -rf "$TMP_DIR"

echo ""
echo "✅ AI-Worker has been installed to ${INSTALL_DIR}/${APP_NAME}.app"
echo "🎉 Launching AI-Worker..."
open "${INSTALL_DIR}/${APP_NAME}.app"
