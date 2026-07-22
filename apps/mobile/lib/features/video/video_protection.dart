import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:screen_protector/screen_protector.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// When false, screenshots/recordings are not blacked out (needed for App Review).
/// Re-enable before production if content protection is required again.
const bool kEnableScreenshotHardening = false;

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

  /// True when identity overlays should be visible (only while casting).
  bool get showIdentityOverlay => isCasting;

  Future<void> enable() async {
    await enableScreenHardening();

    if (kEnableScreenshotHardening && Platform.isIOS) {
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
      if (kEnableScreenshotHardening && Platform.isIOS) {
        ScreenProtector.removeListener();
      }
    } catch (_) {}
    await disableScreenHardening();
  }

  /// Nested refcount so course-detail page + inline player can share hardening.
  static int _hardenCount = 0;

  /// Enables screenshot / recording hardening without a video watermark controller.
  static Future<void> enableScreenHardening() async {
    if (!kEnableScreenshotHardening) return;
    _hardenCount++;
    if (_hardenCount > 1) return;
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
    if (!kEnableScreenshotHardening) return;
    if (_hardenCount <= 0) return;
    _hardenCount--;
    if (_hardenCount > 0) return;
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
    if (casting) {
      _startWatermarkMotion();
    } else {
      _watermarkTimer?.cancel();
    }
    _notify();
  }

  void setScreenCaptured(bool captured) {
    if (isScreenCaptured == captured) return;
    isScreenCaptured = captured;
    // Keep a solid black frame for the entire recording session.
    screenshotBlocked = kEnableScreenshotHardening && captured;
    _notify();
  }

  void onScreenshotDetected() {
    if (!kEnableScreenshotHardening) return;
    screenshotBlocked = true;
    _notify();
    Future.delayed(const Duration(seconds: 2), () {
      // Don't clear while an active screen recording is still going.
      if (!isScreenCaptured) {
        screenshotBlocked = false;
        _notify();
      }
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

/// Moving watermark — visible only while casting to an external device.
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
    if (!kEnableScreenshotHardening || !visible) {
      return const SizedBox.shrink();
    }
    return const Positioned.fill(child: ColoredBox(color: Colors.black));
  }
}

/// Persistent viewer stamp on the video frame while casting.
class PlaybackViewerStamp extends StatelessWidget {
  const PlaybackViewerStamp({super.key, required this.controller});

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.isCasting) return const SizedBox.shrink();

    final text = controller.watermarkText;
    if (text.isEmpty) return const SizedBox.shrink();

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

/// Large footer panel so viewer identity stays visible on the cast screen.
class CastingIdentityFooter extends StatelessWidget {
  const CastingIdentityFooter({super.key, required this.controller});

  final VideoProtectionController controller;

  @override
  Widget build(BuildContext context) {
    if (!controller.isCasting) return const SizedBox.shrink();

    final text = controller.watermarkText;
    if (text.isEmpty) return const SizedBox.shrink();

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: IgnorePointer(
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.fromLTRB(
            16,
            14,
            16,
            14 + MediaQuery.paddingOf(context).bottom,
          ),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.transparent,
                Colors.black.withValues(alpha: 0.85),
              ],
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cast_connected, color: Colors.amber, size: 22),
              const SizedBox(height: 6),
              Text(
                'Casting as',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.75),
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                text,
                textAlign: TextAlign.center,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.amber,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Rebuilds cast overlays when protection state or watermark position changes.
class VideoProtectionOverlay extends StatefulWidget {
  const VideoProtectionOverlay({
    super.key,
    required this.controller,
    required this.child,
    this.showFooter = false,
    this.showBrandLogo = true,
  });

  final VideoProtectionController controller;
  final Widget child;
  final bool showFooter;
  final bool showBrandLogo;

  @override
  State<VideoProtectionOverlay> createState() => _VideoProtectionOverlayState();
}

class _VideoProtectionOverlayState extends State<VideoProtectionOverlay> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_repaint);
  }

  @override
  void didUpdateWidget(VideoProtectionOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_repaint);
      widget.controller.addListener(_repaint);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_repaint);
    super.dispose();
  }

  void _repaint() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (widget.showBrandLogo) const VideoBrandLogo(markSize: 24),
        PlaybackViewerStamp(controller: widget.controller),
        DynamicWatermark(controller: widget.controller),
        CastingIdentityBanner(controller: widget.controller),
        if (widget.showFooter) CastingIdentityFooter(controller: widget.controller),
      ],
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
  final user = auth.user;
  final missingIdentity = user == null ||
      user.fullLegalName == null ||
      user.fullLegalName!.trim().isEmpty ||
      user.nationalId == null ||
      user.nationalId!.trim().isEmpty;
  if (missingIdentity) {
    await auth.refreshUser();
  }
  final refreshed = auth.user;
  protection.updateIdentity(
    studentName: refreshed?.fullLegalName?.trim().isNotEmpty == true
        ? refreshed!.fullLegalName!.trim()
        : fallbackName,
    nationalId: refreshed?.nationalId?.trim() ?? '',
    phone: refreshed?.phone.trim() ?? '',
  );
}
