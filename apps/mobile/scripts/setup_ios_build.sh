#!/bin/bash
# Keep Flutter's build/ off Desktop/iCloud so codesign doesn't fail with:
#   "resource fork, Finder information, or similar detritus not allowed"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${HOME}/Library/Caches/ulearn-mobile-build"
LINK="${ROOT}/build"

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

ln -s "${CACHE}" "${LINK}"
echo "Linked ${LINK} → ${CACHE}"
