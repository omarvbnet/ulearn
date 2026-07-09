#!/bin/bash
# Strip iCloud/Desktop xattrs around Flutter compile — without racing native asset builds.
set -euo pipefail

export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"

strip_xattrs() {
  local path="$1"
  if [ -e "${path}" ]; then
    xattr -cr "${path}" 2>/dev/null || true
  fi
}

# Pre-clean only extended attributes (do not dot_clean or touch native_assets mid-build).
strip_xattrs "${BUILD_DIR}"

/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" build

# Post-clean for codesign (resource forks on Desktop/iCloud paths).
strip_xattrs "${BUILD_DIR}/native_assets"
strip_xattrs "${BUILD_DIR}/ios"
