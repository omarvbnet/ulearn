#!/bin/bash
# Strip iCloud/Desktop xattrs around Flutter compile — without racing native asset builds.
set -euo pipefail

export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"

# Prefer off-Desktop cache symlink (survives reboots better than /tmp).
if [ ! -e "${BUILD_DIR}" ] || { [ -L "${BUILD_DIR}" ] && [ ! -e "$(readlink "${BUILD_DIR}" 2>/dev/null || true)" ]; }; then
  /bin/sh "${ROOT}/scripts/setup_ios_build.sh" || true
fi

strip_xattrs() {
  local path="$1"
  if [ -e "${path}" ]; then
    xattr -cr "${path}" 2>/dev/null || true
    find "${path}" -type f \( -name 'App' -o -name '*.dylib' -o -name 'Flutter' \) -print0 2>/dev/null \
      | xargs -0 xattr -c 2>/dev/null || true
  fi
}

# Pre-clean only extended attributes (do not dot_clean or touch native_assets mid-build).
strip_xattrs "${BUILD_DIR}"

/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" build

# Post-clean for codesign (resource forks on Desktop/iCloud paths).
strip_xattrs "${BUILD_DIR}/native_assets"
strip_xattrs "${BUILD_DIR}/ios"
# Flutter codesigns App.framework during package — strip right before return.
strip_xattrs "${BUILD_DIR}/ios/Release-iphoneos/App.framework"
strip_xattrs "${BUILD_DIR}/ios/Debug-iphoneos/App.framework"
strip_xattrs "${BUILD_DIR}/ios/Release-iphoneos/Flutter.framework"
strip_xattrs "${BUILD_DIR}/ios/Debug-iphoneos/Flutter.framework"
