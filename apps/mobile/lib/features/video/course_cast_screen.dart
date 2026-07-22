import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_to_airplay/flutter_to_airplay.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/cast_watermarked_video.dart';
import 'package:ulearn/core/video/course_cast_service.dart';
import 'package:ulearn/features/video/native_airplay_player.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// Full-screen cast experience with a server-burned viewer watermark in the stream.
class CourseCastScreen extends StatefulWidget {
  const CourseCastScreen({
    super.key,
    required this.url,
    required this.title,
    required this.protection,
    this.lessonId,
    this.lessonKind = CastLessonKind.store,
    this.positionMs = 0,
    this.onClose,
  });

  final String url;
  final String title;
  final VideoProtectionController protection;
  final String? lessonId;
  final CastLessonKind lessonKind;
  final int positionMs;
  final VoidCallback? onClose;

  @override
  State<CourseCastScreen> createState() => _CourseCastScreenState();
}

class _CourseCastScreenState extends State<CourseCastScreen> {
  StreamSubscription<bool>? _castSub;
  bool _androidBusy = false;
  String? _message;
  late String _castUrl;
  bool _burnedWatermark = false;
  bool _preparing = true;

  @override
  void initState() {
    super.initState();
    _castUrl = widget.url;
    widget.protection.addListener(_repaint);
    _prepareCast();
  }

  void _repaint() {
    if (mounted) setState(() {});
  }

  Future<void> _resolveCastUrl() async {
    final l10n = context.l10nRead;
    final lessonId = widget.lessonId;
    if (lessonId == null || lessonId.isEmpty) {
      setState(() {
        _preparing = false;
        _message = l10n.t('mobile.cast.castingToTv');
      });
      return;
    }

    setState(() {
      _preparing = true;
      _message = l10n.t('mobile.cast.preparingWatermark');
    });

    final api = context.read<ApiClient>();
    final watermarked = await CastWatermarkedVideo.fetchUrl(
      api: api,
      kind: widget.lessonKind,
      lessonId: lessonId,
    );

    if (!mounted) return;
    if (watermarked != null) {
      setState(() {
        _castUrl = watermarked;
        _burnedWatermark = true;
        _preparing = false;
        _message = l10n.t('mobile.cast.watermarkReady');
      });
      return;
    }

    setState(() {
      _castUrl = widget.url;
      _burnedWatermark = false;
      _preparing = false;
      _message = l10n.t('mobile.cast.watermarkFallback');
    });
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

    await _resolveCastUrl();
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

  Future<void> _startAndroidCast() async {
    final l10n = context.l10n;
    setState(() {
      _androidBusy = true;
      _message = _preparing
          ? l10n.t('mobile.cast.preparingWatermark')
          : l10n.t('mobile.cast.searching');
    });
    final ok = await CourseCastService.castVideo(
      url: _castUrl,
      title: widget.title,
      watermark: widget.protection.watermarkText,
      positionMs: widget.positionMs,
    );
    if (!mounted) return;
    setState(() {
      _androidBusy = false;
      _message = ok
          ? (_burnedWatermark
              ? l10n.t('mobile.cast.watermarkReady')
              : l10n.t('mobile.cast.connected'))
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
    final showOverlay = !_burnedWatermark && casting;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: GlassAppBar(
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
      body: showOverlay
          ? VideoProtectionOverlay(
              controller: widget.protection,
              showFooter: true,
              child: _castBody(l10n, casting),
            )
          : _castBody(l10n, casting),
    );
  }

  Widget _castBody(dynamic l10n, bool casting) {
    return Stack(
      fit: StackFit.expand,
      children: [
        if (_preparing)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(color: AppTheme.accent),
                  const SizedBox(height: 20),
                  Text(
                    l10n.t('mobile.cast.preparingWatermark'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4),
                  ),
                ],
              ),
            ),
          )
        else if (Platform.isIOS)
          NativeAirPlayPlayer(
            key: ValueKey(_castUrl),
            url: _castUrl,
            watermark: _burnedWatermark ? '' : widget.protection.watermarkText,
          )
        else
          _AndroidCastPanel(
            busy: _androidBusy,
            message: _message,
            watermark: casting ? widget.protection.watermarkText : null,
            burnedIn: _burnedWatermark,
            onPickDevice: () => CourseCastService.showDevicePicker(),
          ),
        if (Platform.isIOS && !_preparing)
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
    );
  }
}

class _AndroidCastPanel extends StatelessWidget {
  const _AndroidCastPanel({
    required this.busy,
    required this.message,
    required this.watermark,
    required this.burnedIn,
    required this.onPickDevice,
  });

  final bool busy;
  final String? message;
  final String? watermark;
  final bool burnedIn;
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
              Icon(
                burnedIn ? Icons.verified_user_outlined : Icons.cast,
                color: AppTheme.accent,
                size: 56,
              ),
            const SizedBox(height: 20),
            Text(
              message ?? l10n.t('mobile.cast.castingToTv'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4),
            ),
            if (burnedIn) ...[
              const SizedBox(height: 10),
              Text(
                l10n.t('mobile.cast.watermarkBurnedIn'),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.greenAccent.withValues(alpha: 0.9),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ] else if (watermark != null) ...[
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
  String? lessonId,
  CastLessonKind lessonKind = CastLessonKind.store,
}) async {
  onPause();
  await Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => CourseCastScreen(
        url: url,
        title: title,
        protection: protection,
        lessonId: lessonId,
        lessonKind: lessonKind,
        positionMs: positionMs,
      ),
    ),
  );
  onResume();
}
