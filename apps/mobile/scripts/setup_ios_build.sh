#!/bin/bash
# Keep Flutter's build/ off Desktop/iCloud/exFAT so codesign doesn't fail with:
#   "resource fork, Finder information, or similar detritus not allowed"
# Prefer the APFS sparse image when mounted; auto-attach it when needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LINK="${ROOT}/build"
SPARSEBUNDLE="/Volumes/T7 Shield/Android/ULearnBuild.sparsebundle"
HOME_MOUNT="${HOME}/ULearnBuild"

ensure_build_volume() {
  # Already mounted and writable?
  if [ -d "${HOME_MOUNT}/mobile-build" ] && [ -w "${HOME_MOUNT}" ]; then
    return 0
  fi
  if [ -d /Volumes/ULearnBuild/mobile-build ] && [ -w /Volumes/ULearnBuild ]; then
    return 0
  fi

  # Sparsebundle must exist on the T7.
  if [ ! -d "${SPARSEBUNDLE}" ]; then
    return 1
  fi

  # Clear empty placeholder that blocks remount.
  if [ -d "${HOME_MOUNT}" ] && [ -z "$(ls -A "${HOME_MOUNT}" 2>/dev/null || true)" ]; then
    rmdir "${HOME_MOUNT}" 2>/dev/null || true
  fi
  mkdir -p "${HOME_MOUNT}"

  # Detach any previous attachment of this image, then remount at ~/ULearnBuild.
  local attached
  attached="$(hdiutil info 2>/dev/null | awk -v p="${SPARSEBUNDLE}" '
    $0 ~ p {found=1}
    found && /\/dev\/disk[0-9]+[[:space:]]/ {print $1; exit}
  ' || true)"
  if [ -n "${attached}" ]; then
    hdiutil detach "${attached}" -force >/dev/null 2>&1 || true
    sleep 1
  fi

  hdiutil attach "${SPARSEBUNDLE}" -mountpoint "${HOME_MOUNT}" -nobrowse >/dev/null 2>&1 || return 1
  mkdir -p "${HOME_MOUNT}/mobile-build" "${HOME_MOUNT}/tmp" "${HOME_MOUNT}/gradle"
  return 0
}

ensure_build_volume || true

if [ -d /Volumes/ULearnBuild/mobile-build ] && [ -w /Volumes/ULearnBuild ]; then
  CACHE="/Volumes/ULearnBuild/mobile-build"
elif [ -d "${HOME_MOUNT}/mobile-build" ] && [ -w "${HOME_MOUNT}" ]; then
  CACHE="${HOME_MOUNT}/mobile-build"
else
  CACHE="${HOME}/Library/Caches/ulearn-mobile-build"
fi

mkdir -p "${CACHE}"
export COPYFILE_DISABLE=1
xattr -cr "${CACHE}" 2>/dev/null || true
dot_clean -m "${CACHE}" 2>/dev/null || true

if [ -L "${LINK}" ]; then
  target="$(readlink "${LINK}")"
  if [ "${target}" = "${CACHE}" ] && [ -d "${CACHE}" ]; then
    echo "build → ${CACHE} (ok)"
    exit 0
  fi
  rm -f "${LINK}"
elif [ -d "${LINK}" ]; then
  # Preserve existing local build contents into cache once.
  rsync -a "${LINK}/" "${CACHE}/" 2>/dev/null || true
  rm -rf "${LINK}"
elif [ -e "${LINK}" ]; then
  rm -rf "${LINK}"
fi

ln -sfn "${CACHE}" "${LINK}"
echo "Linked ${LINK} → ${CACHE}"
