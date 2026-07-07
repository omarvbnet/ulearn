import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:screen_protector/screen_protector.dart';

/// Video protection: FLAG_SECURE (Android), screenshot detection (iOS),
/// dynamic watermark when casting, and casting/mirroring awareness.
class VideoProtectionController {
  VideoProtectionController({
    required this.studentName,
    required this.nationalId,
    required this.phone,
  });

  final String studentName;
  final String nationalId;
  final String phone;

  bool isCasting = false;
  bool screenshotBlocked = false;
  Offset watermarkOffset = const Offset(24, 80);
  Timer? _watermarkTimer;
  final _listeners = <VoidCallback>[];

  void addListener(VoidCallback cb) => _listeners.add(cb);
  void removeListener(VoidCallback cb) => _listeners.remove(cb);
  void _notify() {
    for (final cb in _listeners) {
      cb();
    }
  }

  Future<void> enable() async {
    try {
      await ScreenProtector.protectDataLeakageOn();
      if (Platform.isIOS) {
        await ScreenProtector.preventScreenshotOn();
      }
    } catch (_) {
      // Plugin may be unavailable on some platforms/simulators.
    }

    // Android FLAG_SECURE via platform channel fallback
    if (Platform.isAndroid) {
      try {
        const channel = MethodChannel('ulearn/security');
        await channel.invokeMethod('enableSecureFlag');
      } catch (_) {}
    }

    _startWatermarkMotion();
  }

  Future<void> disable() async {
    _watermarkTimer?.cancel();
    try {
      await ScreenProtector.protectDataLeakageOff();
      if (Platform.isIOS) {
        await ScreenProtector.preventScreenshotOff();
      }
    } catch (_) {}

    if (Platform.isAndroid) {
      try {
        const channel = MethodChannel('ulearn/security');
        await channel.invokeMethod('disableSecureFlag');
      } catch (_) {}
    }
  }

  /// Call when TV casting / AirPlay / HDMI / mirroring is detected.
  void setCasting(bool casting) {
    isCasting = casting;
    if (casting) {
      _startWatermarkMotion();
    }
    _notify();
  }

  void onScreenshotDetected() {
    screenshotBlocked = true;
    _notify();
    Future.delayed(const Duration(seconds: 2), () {
      screenshotBlocked = false;
      _notify();
    });
  }

  void _startWatermarkMotion() {
    _watermarkTimer?.cancel();
    _watermarkTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      watermarkOffset = Offset(
        24 + (DateTime.now().second % 10) * 18.0,
        60 + (DateTime.now().millisecond % 200).toDouble(),
      );
      _notify();
    });
  }

  String get watermarkText {
    final now = DateTime.now().toIso8601String();
    return '$studentName | $nationalId | $phone | $now';
  }
}

/// Semi-transparent moving watermark — shown only while casting.
class DynamicWatermark extends StatelessWidget {
  const DynamicWatermark({
    super.key,
    required this.controller,
  });

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.isCasting) return const SizedBox.shrink();

    return Positioned(
      left: controller.watermarkOffset.dx,
      top: controller.watermarkOffset.dy,
      child: IgnorePointer(
        child: Opacity(
          opacity: 0.35,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              controller.watermarkText,
              style: const TextStyle(color: Colors.white, fontSize: 11),
            ),
          ),
        ),
      ),
    );
  }
}

/// Black overlay shown on iOS when a screenshot is detected.
class ScreenshotBlockOverlay extends StatelessWidget {
  const ScreenshotBlockOverlay({super.key, required this.visible});

  final bool visible;

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();
    return const Positioned.fill(
      child: ColoredBox(color: Colors.black),
    );
  }
}
