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

PODS_CHECK="ios/Pods/Target Support Files/Pods-Runner/Pods-Runner.debug.xcconfig"
FIREBASE_CHECK="ios/Pods/FirebaseCore/FirebaseCore/Sources/Public/FirebaseCore/FIRApp.h"
GOOGLEUTILS_CHECK="ios/Pods/GoogleUtilities/GoogleUtilities/AppDelegateSwizzler/Public/GoogleUtilities/GULAppDelegateSwizzler.h"
DKPHOTO_CHECK="ios/Pods/DKPhotoGallery/DKPhotoGallery/Preview/PDFPreview/DKPDFView.swift"
DKIMAGE_CHECK="ios/Pods/DKImagePickerController/Sources/DKImagePickerController/View/Cell/DKAssetGroupDetailCameraCell.swift"

if [ ! -f "$PODS_CHECK" ] || [ ! -f "$FIREBASE_CHECK" ] || [ ! -f "$GOOGLEUTILS_CHECK" ] || [ ! -f "$DKPHOTO_CHECK" ] || [ ! -f "$DKIMAGE_CHECK" ]; then
  echo "CocoaPods incomplete or corrupted — reinstalling..."
  rm -rf ios/Pods ios/Podfile.lock ios/.symlinks
  flutter pub get
  (cd ios && pod install --repo-update)
  echo "CocoaPods reinstalled."
fi

# Clean duplicate iCloud copies in Flutter generated folder only (never touch Pods/).
find ios/Flutter -maxdepth 1 \( -name 'Flutter [0-9]*.podspec' -o -name 'Generated [0-9]*.xcconfig' -o -name 'flutter_export_environment [0-9]*.sh' \) -delete 2>/dev/null || true

echo "iOS environment ready."
