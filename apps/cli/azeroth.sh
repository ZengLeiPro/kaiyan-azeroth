#!/usr/bin/env bash
set -euo pipefail
# Development wrapper: resolve tsx through the workspace package manager instead of pnpm's
# versioned virtual-store layout. Production/standalone callers should use dist/index.js.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$MONO_ROOT"
exec pnpm --filter @ky-azeroth/cli exec tsx "$SCRIPT_DIR/src/index.ts" "$@"
