#!/bin/bash
# One-time setup: symlink build/ to /tmp to avoid Desktop iCloud codesign issues.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_BUILD="/tmp/ulearn-mobile-build"

cd "$ROOT"
mkdir -p "$TMP_BUILD"

if [ -L "build" ] && [ "$(readlink build)" = "$TMP_BUILD" ]; then
  echo "build/ already linked to $TMP_BUILD"
  exit 0
fi

rm -rf build
ln -s "$TMP_BUILD" build
echo "Linked build/ -> $TMP_BUILD"
