#!/bin/bash
# Strip iCloud/Desktop xattrs around Flutter compile — without racing native asset builds.
set -euo pipefail

export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"
CACHE="${HOME}/Library/Caches/ulearn-mobile-build"

# Always keep build/ off Desktop/iCloud (real dirs get FinderInfo and fail codesign).
/bin/sh "${ROOT}/scripts/setup_ios_build.sh" || true

strip_xattrs() {
  local path="$1"
  if [ -e "${path}" ]; then
    # Avoid find|xargs — large trees hit ARG_MAX ("command line cannot be assembled, too long").
    # xattr -cr already recurses safely.
    dot_clean -m "${path}" 2>/dev/null || true
    xattr -cr "${path}" 2>/dev/null || true
  fi
}

strip_xattrs "${BUILD_DIR}"
strip_xattrs "${CACHE}"

set +e
/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" build
BUILD_STATUS=$?
set -e

# Flutter codesigns native assets during `build`; strip again for any leftover tags.
strip_xattrs "${BUILD_DIR}/native_assets"
strip_xattrs "${BUILD_DIR}/ios"
strip_xattrs "${BUILD_DIR}/ios/Release-iphoneos/App.framework"
strip_xattrs "${BUILD_DIR}/ios/Debug-iphoneos/App.framework"
strip_xattrs "${BUILD_DIR}/ios/Release-iphoneos/Flutter.framework"
strip_xattrs "${BUILD_DIR}/ios/Debug-iphoneos/Flutter.framework"
strip_xattrs "${CACHE}/native_assets"

exit ${BUILD_STATUS}
