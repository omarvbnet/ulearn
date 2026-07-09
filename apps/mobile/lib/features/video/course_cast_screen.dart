import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_to_airplay/flutter_to_airplay.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/course_cast_service.dart';
import 'package:ulearn/features/video/native_airplay_player.dart';
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
    widget.protection.addListener(_repaint);
    _prepareCast();
  }

  void _repaint() {
    if (mounted) setState(() {});
  }

  Future<void> _prepareCast() async {
    final auth = context.read<AuthProvider>();
    final l10n = context.l10nRead;
    await ensureFreshProtectionIdentity(
      auth,
      widget.protection,
      l10n.t('mobile.roles.student'),
    );
    if (!mounted) return;

    if (Platform.isIOS) {
      widget.protection.setCasting(true);
      setState(() {});
      return;
    }

    _castSub = CourseCastService.castingStream.listen((casting) {
      if (!mounted) return;
      widget.protection.setCasting(casting);
      setState(() {});
    });

    final alreadyCasting = await CourseCastService.isCasting;
    if (alreadyCasting) {
      widget.protection.setCasting(true);
    }
    if (!mounted) return;
    await _startAndroidCast();
  }

  String get _watermarkVttUrl {
    final text = widget.protection.watermarkText;
    return '${ApiClient.baseUrl}/api/cast/watermark?text=${Uri.encodeComponent(text)}';
  }

  Future<void> _startAndroidCast() async {
    final l10n = context.l10n;
    setState(() {
      _androidBusy = true;
      _message = l10n.t('mobile.cast.searching');
    });
    final ok = await CourseCastService.castVideo(
      url: widget.url,
      title: widget.title,
      watermark: widget.protection.watermarkText,
      watermarkVttUrl: _watermarkVttUrl,
      positionMs: widget.positionMs,
    );
    if (!mounted) return;
    setState(() {
      _androidBusy = false;
      _message = ok
          ? l10n.t('mobile.cast.connected')
          : l10n.castChooseChromecast;
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
    widget.protection.removeListener(_repaint);
    _castSub?.cancel();
    if (Platform.isAndroid) {
      CourseCastService.stopCast();
    }
    widget.protection.setCasting(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final casting = widget.protection.isCasting;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (Platform.isAndroid)
            IconButton(
              tooltip: l10n.t('mobile.cast.chooseDevice'),
              icon: const Icon(Icons.devices),
              onPressed: () => CourseCastService.showDevicePicker(),
            ),
          IconButton(
            tooltip: l10n.t('mobile.cast.stopCasting'),
            icon: const Icon(Icons.cast_connected),
            onPressed: _close,
          ),
        ],
      ),
      body: VideoProtectionOverlay(
        controller: widget.protection,
        showFooter: true,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (Platform.isIOS)
              NativeAirPlayPlayer(
                key: ValueKey(widget.protection.watermarkText),
                url: widget.url,
                watermark: widget.protection.watermarkText,
              )
            else
              _AndroidCastPanel(
                busy: _androidBusy,
                message: _message,
                watermark: casting ? widget.protection.watermarkText : null,
                onPickDevice: () => CourseCastService.showDevicePicker(),
              ),
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
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AirPlayRoutePickerView(
                        tintColor: Colors.white,
                        activeTintColor: AppTheme.accent,
                        backgroundColor: Colors.transparent,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        l10n.t('mobile.cast.airplay'),
                        style: const TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
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
  final String? watermark;
  final VoidCallback onPickDevice;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
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
              message ?? l10n.t('mobile.cast.castingToTv'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4),
            ),
            if (watermark != null) ...[
              const SizedBox(height: 12),
              Text(
                watermark!,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.amber.withValues(alpha: 0.9),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onPickDevice,
              icon: const Icon(Icons.devices),
              label: Text(l10n.castChooseChromecast),
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
