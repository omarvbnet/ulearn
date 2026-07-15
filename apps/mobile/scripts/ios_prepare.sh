#!/bin/bash
# Prepare iOS build on macOS Desktop/iCloud (prevents corrupted Pods + codesign failures).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export COPYFILE_DISABLE=1

TMP_BUILD="/tmp/ulearn-mobile-build"
mkdir -p "$TMP_BUILD"

if [ -d "build" ] && [ ! -L "build" ]; then
  echo "Moving build/ off Desktop (avoids iCloud xattr on codesign)..."
  rm -rf "$TMP_BUILD"/*
  if [ -n "$(ls -A build 2>/dev/null)" ]; then
    mv build/* "$TMP_BUILD/" 2>/dev/null || true
  fi
  rm -rf build
fi

if [ ! -L "build" ]; then
  ln -s "$TMP_BUILD" build
  echo "Linked build/ -> $TMP_BUILD"
fi

dot_clean -m "$TMP_BUILD" 2>/dev/null || true
xattr -cr "$TMP_BUILD" 2>/dev/null || true

# Stale partial iOS output can reference native assets that were never compiled.
STALE_MANIFEST="$TMP_BUILD/ios/Release-iphoneos/Runner.app/Frameworks/App.framework/flutter_assets/NativeAssetsManifest.json"
STALE_MANIFEST_ALT="$TMP_BUILD/ios/iphoneos/Runner.app/Frameworks/App.framework/flutter_assets/NativeAssetsManifest.json"
if { [ -f "$STALE_MANIFEST" ] || [ -f "$STALE_MANIFEST_ALT" ]; } \
   && [ ! -d "$TMP_BUILD/native_assets/ios/objective_c.framework" ]; then
  echo "Clearing stale build cache (native assets out of sync)..."
  rm -rf "$TMP_BUILD"/*
  rm -rf "$ROOT/.dart_tool/flutter_build"
  flutter pub get >/dev/null 2>&1 || true
fi

PODS_CHECK="ios/Pods/Target Support Files/Pods-Runner/Pods-Runner.debug.xcconfig"
FIREBASE_CHECK="ios/Pods/FirebaseCore/FirebaseCore/Sources/Public/FirebaseCore/FIRApp.h"
GOOGLEUTILS_CHECK="ios/Pods/GoogleUtilities/GoogleUtilities/AppDelegateSwizzler/Public/GoogleUtilities/GULAppDelegateSwizzler.h"
DKPHOTO_CHECK="ios/Pods/DKPhotoGallery/DKPhotoGallery/Preview/PDFPreview/DKPDFView.swift"
DKIMAGE_CHECK="ios/Pods/DKImagePickerController/Sources/DKImagePickerController/View/Cell/DKAssetGroupDetailCameraCell.swift"

if [ ! -f "$PODS_CHECK" ] || [ ! -f "$FIREBASE_CHECK" ] || [ ! -f "$GOOGLEUTILS_CHECK" ] || [ ! -f "$DKPHOTO_CHECK" ] || [ ! -f "$DKIMAGE_CHECK" ]; then
  echo "CocoaPods incomplete or corrupted — reinstalling..."
  rm -rf ios/Pods ios/Podfile.lock ios/.symlinks
  flutter pub get
  (cd ios && pod install)
  echo "CocoaPods reinstalled."
fi

# Clean duplicate iCloud copies in Flutter generated folder.
find ios/Flutter -maxdepth 1 \( -name 'Flutter [0-9]*.podspec' -o -name 'Generated [0-9]*.xcconfig' -o -name 'flutter_export_environment [0-9]*.sh' \) -delete 2>/dev/null || true

# iCloud can also duplicate files inside Pods (e.g. pb_decode 2.c), causing linker errors.
if find ios/Pods -name '* [0-9]*' -print -quit 2>/dev/null | grep -q .; then
  echo "Duplicate iCloud Pod copies detected — reinstalling CocoaPods..."
  rm -rf ios/Pods ios/Podfile.lock ios/.symlinks
  flutter pub get
  (cd ios && pod install)
  echo "CocoaPods reinstalled after duplicate cleanup."
fi

echo "iOS environment ready."
