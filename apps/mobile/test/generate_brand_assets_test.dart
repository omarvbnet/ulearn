// Renders the code-based ULearnLogoPainter into the PNG assets needed by
// flutter_launcher_icons and flutter_native_splash, so the app icon and
// native launch screen are generated from the same vector logo code.
//
// Run with: flutter test test/generate_brand_assets_test.dart
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

Future<void> _savePng({
  required String path,
  required int size,
  Color? background,
  double logoScale = 0.78,
}) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final full = size.toDouble();

  if (background != null) {
    // Subtle radial brand backdrop instead of a flat fill.
    canvas.drawRect(
      Rect.fromLTWH(0, 0, full, full),
      Paint()
        ..shader = ui.Gradient.radial(
          Offset(full / 2, full * 0.42),
          full * 0.75,
          [const Color(0xFF141232), background],
        ),
    );
  }

  final logoSize = full * logoScale;
  final offset = (full - logoSize) / 2;
  canvas.save();
  canvas.translate(offset, offset);
  ULearnLogoPainter(progress: 1, glow: 0.8)
      .paint(canvas, Size(logoSize, logoSize));
  canvas.restore();

  final image = await recorder.endRecording().toImage(size, size);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  final file = File(path)..createSync(recursive: true);
  file.writeAsBytesSync(bytes!.buffer.asUint8List());
  debugPrint('wrote $path');
}

void main() {
  test('generate brand assets', () async {
    const dir = 'assets/brand';
    // Full app icon (dark background baked in).
    await _savePng(path: '$dir/icon.png', size: 1024, background: const Color(0xFF050510));
    // Adaptive icon foreground (transparent, smaller safe zone).
    await _savePng(path: '$dir/icon_foreground.png', size: 1024, logoScale: 0.56);
    // Native splash logo (transparent background).
    await _savePng(path: '$dir/splash_logo.png', size: 1152, logoScale: 0.6);
  });
}
