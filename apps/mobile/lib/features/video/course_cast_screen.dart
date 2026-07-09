import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_to_airplay/flutter_to_airplay.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/course_cast_service.dart';
import 'package:ulearn/features/video/video_protection.dart';

/// Full-screen cast experience: native AirPlay (iOS) or Chromecast (Android)
/// with the viewer name + national ID watermark kept on screen.
class CourseCastScreen extends StatefulWidget {
  const CourseCastScreen({
    super.key,
    required this.url,
    required this.title,
    required this.protection,
    this.positionMs = 0,
    this.onClose,
  });

  final String url;
  final String title;
  final VideoProtectionController protection;
  final int positionMs;
  final VoidCallback? onClose;

  @override
  State<CourseCastScreen> createState() => _CourseCastScreenState();
}

class _CourseCastScreenState extends State<CourseCastScreen> {
  StreamSubscription<bool>? _castSub;
  bool _androidBusy = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    widget.protection.setCasting(true);
    if (Platform.isAndroid) {
      _castSub = CourseCastService.castingStream.listen((casting) {
        if (!mounted) return;
        widget.protection.setCasting(casting);
        setState(() {});
      });
      _startAndroidCast();
    }
  }

  Future<void> _startAndroidCast() async {
    setState(() {
      _androidBusy = true;
      _message = 'Searching for cast devices…';
    });
    final ok = await CourseCastService.castVideo(
      url: widget.url,
      title: widget.title,
      watermark: widget.protection.watermarkText,
      positionMs: widget.positionMs,
    );
    if (!mounted) return;
    setState(() {
      _androidBusy = false;
      _message = ok
          ? 'Connected — your name and ID appear on the cast screen'
          : 'Pick a Chromecast device to continue';
    });
    if (!ok) {
      await CourseCastService.showDevicePicker();
    }
  }

  Future<void> _close() async {
    if (Platform.isAndroid) {
      await CourseCastService.stopCast();
    }
    widget.protection.setCasting(false);
    widget.onClose?.call();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _castSub?.cancel();
    if (Platform.isAndroid) {
      CourseCastService.stopCast();
    }
    widget.protection.setCasting(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (Platform.isAndroid)
            IconButton(
              tooltip: 'Choose device',
              icon: const Icon(Icons.devices),
              onPressed: () => CourseCastService.showDevicePicker(),
            ),
          IconButton(
            tooltip: 'Stop casting',
            icon: const Icon(Icons.cast_connected),
            onPressed: _close,
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (Platform.isIOS)
            FlutterAVPlayerView(urlString: widget.url)
          else
            _AndroidCastPanel(
              busy: _androidBusy,
              message: _message,
              watermark: widget.protection.watermarkText,
              onPickDevice: () => CourseCastService.showDevicePicker(),
            ),
          const VideoBrandLogo(markSize: 24),
          DynamicWatermark(controller: widget.protection, prominent: true),
          CastingIdentityBanner(controller: widget.protection),
          if (Platform.isIOS)
            Positioned(
              right: 16,
              bottom: 24 + MediaQuery.paddingOf(context).bottom,
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AirPlayRoutePickerView(
                      tintColor: Colors.white,
                      activeTintColor: AppTheme.accent,
                      backgroundColor: Colors.transparent,
                    ),
                    SizedBox(height: 4),
                    Text(
                      'AirPlay',
                      style: TextStyle(color: Colors.white70, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AndroidCastPanel extends StatelessWidget {
  const _AndroidCastPanel({
    required this.busy,
    required this.message,
    required this.watermark,
    required this.onPickDevice,
  });

  final bool busy;
  final String? message;
  final String watermark;
  final VoidCallback onPickDevice;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (busy)
              const CircularProgressIndicator(color: AppTheme.accent)
            else
              const Icon(Icons.cast, color: AppTheme.accent, size: 56),
            const SizedBox(height: 20),
            Text(
              message ?? 'Casting to your TV',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4),
            ),
            const SizedBox(height: 12),
            Text(
              watermark,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.amber.withValues(alpha: 0.9),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onPickDevice,
              icon: const Icon(Icons.devices),
              label: const Text('Choose Chromecast'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens the cast screen and pauses the inline player while casting.
Future<void> openCourseCastScreen(
  BuildContext context, {
  required String url,
  required String title,
  required VideoProtectionController protection,
  required VoidCallback onPause,
  required VoidCallback onResume,
  int positionMs = 0,
}) async {
  onPause();
  await Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => CourseCastScreen(
        url: url,
        title: title,
        protection: protection,
        positionMs: positionMs,
      ),
    ),
  );
  onResume();
}
