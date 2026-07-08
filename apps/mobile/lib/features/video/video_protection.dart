import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:screen_protector/screen_protector.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// Video protection: screen capture hardening, casting awareness, and a
/// moving viewer watermark (name + user id) when casting to another screen.
class VideoProtectionController {
  VideoProtectionController({
    required this.studentName,
    required this.userId,
    required this.phone,
  });

  final String studentName;
  final String userId;
  final String phone;

  bool isCasting = false;
  bool screenshotBlocked = false;
  Offset watermarkOffset = const Offset(24, 80);
  Timer? _watermarkTimer;
  final _listeners = <VoidCallback>[];
  final _rand = math.Random();

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
    } catch (_) {}

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

  /// Toggle when the learner casts / mirrors to another display.
  void setCasting(bool casting) {
    isCasting = casting;
    if (casting) _startWatermarkMotion();
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
    _watermarkTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      watermarkOffset = Offset(
        16 + _rand.nextDouble() * 120,
        48 + _rand.nextDouble() * 160,
      );
      _notify();
    });
  }

  String get watermarkText => '$studentName · ID: ${userId.substring(0, 8)}';
}

/// Moving watermark — visible while casting.
class DynamicWatermark extends StatelessWidget {
  const DynamicWatermark({super.key, required this.controller});

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.isCasting) return const SizedBox.shrink();

    return AnimatedPositioned(
      duration: const Duration(milliseconds: 1800),
      curve: Curves.easeInOut,
      left: controller.watermarkOffset.dx,
      top: controller.watermarkOffset.dy,
      child: IgnorePointer(
        child: Opacity(
          opacity: 0.42,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: Colors.white24),
            ),
            child: Text(
              controller.watermarkText,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.3,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// U Learn code-drawn logo pinned to the top-left of the video frame.
class VideoBrandLogo extends StatelessWidget {
  const VideoBrandLogo({super.key, this.markSize = 22});

  final double markSize;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 10,
      top: 10,
      child: IgnorePointer(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              ULearnLogo(size: markSize, glow: 0.3),
              const SizedBox(width: 4),
              Text(
                'U Learn',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: markSize * 0.45,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ScreenshotBlockOverlay extends StatelessWidget {
  const ScreenshotBlockOverlay({super.key, required this.visible});

  final bool visible;

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();
    return const Positioned.fill(child: ColoredBox(color: Colors.black));
  }
}
