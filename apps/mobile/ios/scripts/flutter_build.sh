#!/bin/bash
# Remove iCloud/Desktop resource forks before Flutter codesigns native assets.
set -euo pipefail

export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"
NATIVE_ASSETS="${BUILD_DIR}/native_assets"

clean_tree() {
  local path="$1"
  if [ -e "${path}" ]; then
    dot_clean -m "${path}" 2>/dev/null || true
    xattr -cr "${path}" 2>/dev/null || true
  fi
}

clean_build() {
  clean_tree "${BUILD_DIR}"
  clean_tree "${NATIVE_ASSETS}"
  if [ -d "${BUILD_DIR}/ios" ]; then
    clean_tree "${BUILD_DIR}/ios"
  fi
}

clean_build

/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" build &
build_pid=$!

# Keep cleaning while Flutter compiles and signs native assets (objective_c.framework).
while kill -0 "$build_pid" 2>/dev/null; do
  clean_build
  sleep 0.01
done

wait "$build_pid"
clean_build
