#!/bin/bash
# Strips macOS extended attributes, then re-signs nested frameworks.
# xattr after codesign invalidates signatures — always re-sign native assets.
set -euo pipefail
export COPYFILE_DISABLE=1

APP="${TARGET_BUILD_DIR}/${WRAPPER_NAME}"
ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"
if [ -d /Volumes/ULearnBuild/mobile-build ] && [ -w /Volumes/ULearnBuild ]; then
  CACHE="/Volumes/ULearnBuild/mobile-build"
elif [ -d "${HOME}/ULearnBuild" ]; then
  CACHE="${HOME}/ULearnBuild/mobile-build"
else
  CACHE="${HOME}/Library/Caches/ulearn-mobile-build"
fi

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

# Re-sign nested frameworks after xattr strip (device install rejects adhoc/broken sigs).
resign_frameworks() {
  local identity="${EXPANDED_CODE_SIGN_IDENTITY:-}"
  if [ -z "${identity}" ] || [ "${identity}" = "-" ]; then
    echo "warning: no EXPANDED_CODE_SIGN_IDENTITY — skipping nested framework resign"
    return 0
  fi
  local fw_dir="${APP}/Frameworks"
  [ -d "${fw_dir}" ] || return 0
  local fw
  for fw in "${fw_dir}"/*.framework; do
    [ -d "${fw}" ] || continue
    echo "Re-signing $(basename "${fw}") with ${EXPANDED_CODE_SIGN_IDENTITY_NAME:-$identity}"
    /usr/bin/codesign --force --sign "${identity}" \
      --timestamp=none \
      --generate-entitlement-der \
      "${fw}"
  done
}

resign_frameworks
