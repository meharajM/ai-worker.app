#!/usr/bin/env bash
set -euo pipefail

if [ "${ALLOW_UNSUPPORTED_WIN_CROSS_BUILD:-0}" = "1" ]; then
  echo "⚠️ Bypassing Windows preflight checks (ALLOW_UNSUPPORTED_WIN_CROSS_BUILD=1)."
  exit 0
fi

host_os="$(uname -s 2>/dev/null || echo unknown)"
case "$host_os" in
  CYGWIN*|MINGW*|MSYS*)
    host_os="Windows"
    ;;
esac

if [ "$host_os" = "Windows" ]; then
  echo "✅ Windows host detected."
  exit 0
fi

echo "❌ Windows packaging is not supported on this ${host_os} host in the current setup."
echo ""
echo "Reason:"
echo "  Native module rebuilds (notably better-sqlite3) require target-native tooling."
echo "  Cross-compiling Windows artifacts from non-Windows hosts is unstable and fails"
echo "  with node-gyp cross-compile errors."
echo ""
echo "Action:"
echo "  1) Run Windows packaging on a Windows machine (recommended)."
echo "  2) Or use a Windows CI runner (e.g., windows-latest)."
echo "  3) If you intentionally want to try anyway, set:"
echo "     ALLOW_UNSUPPORTED_WIN_CROSS_BUILD=1"
echo ""
exit 1
