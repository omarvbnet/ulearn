import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:screen_protector/screen_protector.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// Video protection: screen capture hardening, casting awareness, and a
/// moving viewer watermark (name + national ID) during playback and casting.
class VideoProtectionController {
  VideoProtectionController({
    required this.studentName,
    required this.nationalId,
    this.phone = '',
  });

  final String studentName;
  final String nationalId;
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

  /// Called when a cast session starts or stops on an external screen.
  void setCasting(bool casting) {
    if (isCasting == casting) return;
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

  String get watermarkText {
    final id = nationalId.trim();
    if (id.isEmpty) return studentName;
    return '$studentName · ID: $id';
  }
}

/// Moving watermark — visible only while casting to another screen.
class DynamicWatermark extends StatelessWidget {
  const DynamicWatermark({
    super.key,
    required this.controller,
  });

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
          opacity: 0.72,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: Colors.amber.withValues(alpha: 0.65)),
            ),
            child: Text(
              controller.watermarkText,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
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

/// Fixed banner shown while casting so the viewer ID stays visible on the phone.
class CastingIdentityBanner extends StatelessWidget {
  const CastingIdentityBanner({super.key, required this.controller});

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.isCasting) return const SizedBox.shrink();

    return Positioned(
      left: 12,
      right: 12,
      top: 12,
      child: IgnorePointer(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.amber.withValues(alpha: 0.55)),
          ),
          child: Row(
            children: [
              const Icon(Icons.cast_connected, color: Colors.amber, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Casting · ${controller.watermarkText}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    height: 1.25,
                  ),
                ),
              ),
            ],
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
