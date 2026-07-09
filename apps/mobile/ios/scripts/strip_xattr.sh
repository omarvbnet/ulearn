#!/bin/bash
# Strips macOS extended attributes before codesign (build/ only — never Pods/).
set -euo pipefail
export COPYFILE_DISABLE=1

APP="${TARGET_BUILD_DIR}/${WRAPPER_NAME}"

if [ -d "${BUILT_PRODUCTS_DIR}" ]; then
  dot_clean -m "${BUILT_PRODUCTS_DIR}" 2>/dev/null || true
  xattr -cr "${BUILT_PRODUCTS_DIR}" 2>/dev/null || true
fi

if [ -d "${APP}" ]; then
  dot_clean -m "${APP}" 2>/dev/null || true
  xattr -cr "${APP}" 2>/dev/null || true
  if [ -d "${APP}/Frameworks" ]; then
    dot_clean -m "${APP}/Frameworks" 2>/dev/null || true
    xattr -cr "${APP}/Frameworks" 2>/dev/null || true
  fi
fi
