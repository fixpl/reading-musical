#!/bin/sh
# Local development only. Invoke with `sh dev.sh` or `npm run dev` (no chmod needed).
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_BIN=$(command -v node) || { printf '%s\n' 'Node.js 22 이상을 먼저 설치해 주세요.' >&2; exit 1; }
exec "$NODE_BIN" "$ROOT/scripts/local-dev.mjs" "$@"
