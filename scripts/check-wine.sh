#!/usr/bin/env bash
set -euo pipefail

host_os="$(uname -s 2>/dev/null || echo unknown)"

# Only enforce Wine presence on Linux hosts where electron-builder relies on it
# for NSIS/signing helpers.
if [ "$host_os" != "Linux" ]; then
  echo "ℹ️ check:wine skipped on ${host_os} host."
  exit 0
fi

if command -v wine >/dev/null 2>&1 || command -v wine64 >/dev/null 2>&1; then
  echo "✅ Wine detected."
  exit 0
fi

echo "❌ Windows build preflight failed on Linux: Wine is required."
echo "   Install dependencies with:"
echo "   ./install_build_deps.sh"
echo "   or manually install wine/wine64, then retry."
exit 1
