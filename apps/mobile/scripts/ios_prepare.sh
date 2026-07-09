#!/bin/bash
# Prepare iOS build on macOS Desktop/iCloud (prevents corrupted Pods + codesign failures).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export COPYFILE_DISABLE=1

TMP_BUILD="/tmp/ulearn-mobile-build"
mkdir -p "$TMP_BUILD"

if [ ! -L "build" ]; then
  rm -rf build
  ln -s "$TMP_BUILD" build
  echo "Linked build/ -> $TMP_BUILD"
fi

PODS_CHECK="ios/Pods/Target Support Files/Pods-Runner/Pods-Runner.debug.xcconfig"
FIREBASE_CHECK="ios/Pods/FirebaseCore/FirebaseCore/Sources/Public/FirebaseCore/FIRApp.h"
GOOGLEUTILS_CHECK="ios/Pods/GoogleUtilities/GoogleUtilities/AppDelegateSwizzler/Public/GoogleUtilities/GULAppDelegateSwizzler.h"
DKPHOTO_CHECK="ios/Pods/DKPhotoGallery/DKPhotoGallery/Preview/PDFPreview/DKPDFView.swift"

if [ ! -f "$PODS_CHECK" ] || [ ! -f "$FIREBASE_CHECK" ] || [ ! -f "$GOOGLEUTILS_CHECK" ] || [ ! -f "$DKPHOTO_CHECK" ]; then
  echo "CocoaPods incomplete or corrupted — reinstalling..."
  rm -rf ios/Pods ios/Podfile.lock ios/.symlinks
  flutter pub get
  (cd ios && pod install --repo-update)
  echo "CocoaPods reinstalled."
fi

# Clean duplicate iCloud copies in Flutter generated folder only (never touch Pods/).
find ios/Flutter -maxdepth 1 \( -name 'Flutter [0-9]*.podspec' -o -name 'Generated [0-9]*.xcconfig' -o -name 'flutter_export_environment [0-9]*.sh' \) -delete 2>/dev/null || true

echo "iOS environment ready."
