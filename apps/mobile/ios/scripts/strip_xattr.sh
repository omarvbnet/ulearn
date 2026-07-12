#!/bin/bash
# Strips macOS extended attributes before codesign (build/ only — never Pods/).
set -euo pipefail
export COPYFILE_DISABLE=1

APP="${TARGET_BUILD_DIR}/${WRAPPER_NAME}"
ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"
CACHE="${HOME}/Library/Caches/ulearn-mobile-build"

# Ensure build stays off Desktop before signing native assets / app.
/bin/sh "${ROOT}/scripts/setup_ios_build.sh" 2>/dev/null || true

for path in \
  "${BUILT_PRODUCTS_DIR}" \
  "${APP}" \
  "${APP}/Frameworks" \
  "${BUILD_DIR}" \
  "${BUILD_DIR}/native_assets" \
  "${CACHE}" \
  "${CACHE}/native_assets"
do
  if [ -e "${path}" ]; then
    dot_clean -m "${path}" 2>/dev/null || true
    xattr -cr "${path}" 2>/dev/null || true
  fi
done
