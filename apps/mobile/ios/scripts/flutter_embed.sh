#!/bin/bash
set -euo pipefail
export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
if [ -d "${ROOT}/build" ]; then
  xattr -cr "${ROOT}/build" 2>/dev/null || true
fi

/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" embed_and_thin
