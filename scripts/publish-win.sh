#!/usr/bin/env bash
# =============================================================================
# publish-win.sh — Windows Release Pipeline → Cloudflare R2
#
# Usage:
#   npm run publish:win
#   npm run publish:win -- --yes
#   npm run publish:win -- --skip-checks
#   npm run publish:win -- --skip-build
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "${SCRIPT_DIR}/publish-linux-win.sh" --win-only "$@"
