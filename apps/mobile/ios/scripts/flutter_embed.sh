#!/bin/bash
set -euo pipefail
export COPYFILE_DISABLE=1

ROOT="${SRCROOT}/.."
BUILD_DIR="${ROOT}/build"
NATIVE_FW="${BUILD_DIR}/native_assets/ios/objective_c.framework"

export COPYFILE_DISABLE=1
/bin/sh "${ROOT}/scripts/setup_ios_build.sh" 2>/dev/null || true

# App.framework may reference native assets before they are compiled (flutter run race).
manifest=""
for candidate in \
  "${TARGET_BUILD_DIR}/${WRAPPER_NAME}/Frameworks/App.framework/flutter_assets/NativeAssetsManifest.json" \
  "${BUILD_DIR}/ios/Release-iphoneos/Runner.app/Frameworks/App.framework/flutter_assets/NativeAssetsManifest.json" \
  "${BUILD_DIR}/ios/iphoneos/Runner.app/Frameworks/App.framework/flutter_assets/NativeAssetsManifest.json"; do
  if [ -f "${candidate}" ]; then
    manifest="${candidate}"
    break
  fi
done

if [ -n "${manifest}" ] && [ ! -d "${NATIVE_FW}" ]; then
  echo "Native assets missing for objective_c — re-running Flutter assemble..."
  (
    cd "${ROOT}"
    "${FLUTTER_ROOT}/bin/flutter" assemble \
      --no-version-check \
      --output="${BUILT_PRODUCTS_DIR:-${BUILD_DIR}/ios/Release-iphoneos}/" \
      -dTargetPlatform=ios \
      -dTargetFile="${FLUTTER_TARGET:-lib/main.dart}" \
      -dBuildMode=release \
      -dConfiguration="${CONFIGURATION:-Release}" \
      -dIosArchs="${ARCHS:-arm64}" \
      -dSdkRoot="${SDKROOT:-iphoneos}" \
      -dTreeShakeIcons="${TREE_SHAKE_ICONS:-true}" \
      -dSrcRoot="${SRCROOT}" \
      release_ios_bundle_flutter_assets
  )
fi

if [ -d "${BUILD_DIR}" ]; then
  xattr -cr "${BUILD_DIR}" 2>/dev/null || true
fi

/bin/sh "$FLUTTER_ROOT/packages/flutter_tools/bin/xcode_backend.sh" embed_and_thin
