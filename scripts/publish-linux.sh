#!/usr/bin/env bash
# =============================================================================
# publish-linux.sh — Linux Release Pipeline → Cloudflare R2
#
# Usage:
#   npm run publish:linux
#   npm run publish:linux -- --yes
#   npm run publish:linux -- --skip-checks
#   npm run publish:linux -- --skip-build
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "${SCRIPT_DIR}/publish-linux-win.sh" --linux-only "$@"
