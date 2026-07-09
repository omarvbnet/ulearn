import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:screen_protector/screen_protector.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// Video protection: screen capture hardening, casting awareness, and a
/// moving viewer watermark (name + national ID) during playback and casting.
class VideoProtectionController {
  VideoProtectionController({
    required String studentName,
    required String nationalId,
    String phone = '',
  })  : _studentName = studentName,
        _nationalId = nationalId,
        _phone = phone;

  String _studentName;
  String _nationalId;
  String _phone;

  bool isCasting = false;
  bool isScreenCaptured = false;
  bool screenshotBlocked = false;
  Offset watermarkOffset = const Offset(24, 80);
  Timer? _watermarkTimer;
  final _listeners = <VoidCallback>[];
  final _rand = math.Random();

  void updateIdentity({
    String? studentName,
    String? nationalId,
    String? phone,
  }) {
    if (studentName != null) _studentName = studentName;
    if (nationalId != null) _nationalId = nationalId;
    if (phone != null) _phone = phone;
    _notify();
  }

  void addListener(VoidCallback cb) => _listeners.add(cb);
  void removeListener(VoidCallback cb) => _listeners.remove(cb);
  void _notify() {
    for (final cb in _listeners) {
      cb();
    }
  }

  /// True when identity overlays should be visible (cast, mirror, or record).
  bool get showIdentityOverlay => isCasting || isScreenCaptured;

  Future<void> enable() async {
    try {
      await ScreenProtector.protectDataLeakageOn();
      await ScreenProtector.preventScreenshotOn();
    } catch (_) {}

    if (Platform.isAndroid) {
      try {
        const channel = MethodChannel('ulearn/security');
        await channel.invokeMethod('enableSecureFlag');
      } catch (_) {}
    }

    if (Platform.isIOS) {
      try {
        ScreenProtector.addListener(
          onScreenshotDetected,
          setScreenCaptured,
        );
      } catch (_) {}
    }
  }

  Future<void> disable() async {
    _watermarkTimer?.cancel();
    try {
      if (Platform.isIOS) {
        ScreenProtector.removeListener();
      }
      await ScreenProtector.protectDataLeakageOff();
      await ScreenProtector.preventScreenshotOff();
    } catch (_) {}

    if (Platform.isAndroid) {
      try {
        const channel = MethodChannel('ulearn/security');
        await channel.invokeMethod('disableSecureFlag');
      } catch (_) {}
    }
  }

  /// Enables screenshot / recording hardening without a video watermark controller.
  static Future<void> enableScreenHardening() async {
    try {
      await ScreenProtector.protectDataLeakageOn();
      await ScreenProtector.preventScreenshotOn();
    } catch (_) {}

    if (Platform.isAndroid) {
      try {
        const channel = MethodChannel('ulearn/security');
        await channel.invokeMethod('enableSecureFlag');
      } catch (_) {}
    }
  }

  static Future<void> disableScreenHardening() async {
    try {
      await ScreenProtector.protectDataLeakageOff();
      await ScreenProtector.preventScreenshotOff();
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
    if (casting || isScreenCaptured) _startWatermarkMotion();
    _notify();
  }

  void setScreenCaptured(bool captured) {
    if (isScreenCaptured == captured) return;
    isScreenCaptured = captured;
    if (captured || isCasting) _startWatermarkMotion();
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
    if (!showIdentityOverlay) return;
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
    final name = _studentName.trim();
    final id = _nationalId.trim();
    final phone = _phone.trim();
    final displayName = name.isNotEmpty
        ? name
        : phone.isNotEmpty
            ? phone
            : 'Viewer';
    if (id.isNotEmpty) return '$displayName · ID: $id';
    if (phone.isNotEmpty && phone != displayName) return '$displayName · $phone';
    return displayName;
  }
}

/// Moving watermark — visible while casting, mirroring, or screen recording.
class DynamicWatermark extends StatelessWidget {
  const DynamicWatermark({
    super.key,
    required this.controller,
  });

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.showIdentityOverlay) return const SizedBox.shrink();

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
    if (!controller.showIdentityOverlay) return const SizedBox.shrink();

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

/// Persistent viewer stamp on the video frame (visible when mirrored / cast).
class PlaybackViewerStamp extends StatelessWidget {
  const PlaybackViewerStamp({super.key, required this.controller});

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    final text = controller.watermarkText;
    if (text.isEmpty || text == 'Viewer') return const SizedBox.shrink();

    return Positioned(
      left: 8,
      right: 8,
      bottom: 50,
      child: IgnorePointer(
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: Colors.white24),
            ),
            child: Text(
              text,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                height: 1.2,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Builds or refreshes protection identity from the signed-in user.
VideoProtectionController videoProtectionFromAuth({
  required AuthProvider auth,
  required String fallbackName,
}) {
  final user = auth.user;
  return VideoProtectionController(
    studentName: user?.fullLegalName?.trim().isNotEmpty == true
        ? user!.fullLegalName!.trim()
        : fallbackName,
    nationalId: user?.nationalId?.trim() ?? '',
    phone: user?.phone.trim() ?? '',
  );
}

Future<void> ensureFreshProtectionIdentity(
  AuthProvider auth,
  VideoProtectionController protection,
  String fallbackName,
) async {
  if (auth.user?.nationalId == null || auth.user!.nationalId!.trim().isEmpty) {
    await auth.refreshUser();
  }
  final user = auth.user;
  protection.updateIdentity(
    studentName: user?.fullLegalName?.trim().isNotEmpty == true
        ? user!.fullLegalName!.trim()
        : fallbackName,
    nationalId: user?.nationalId?.trim() ?? '',
    phone: user?.phone.trim() ?? '',
  );
}
