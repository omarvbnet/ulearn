import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/course_video_cache.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/video/course_cast_screen.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:video_player/video_player.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// Plays a store-course lesson from a direct (presigned) URL,
/// with the same screen protection and watermark as curriculum videos.
class CourseVideoScreen extends StatefulWidget {
  const CourseVideoScreen({super.key, required this.url, required this.title});

  final String url;
  final String title;

  @override
  State<CourseVideoScreen> createState() => _CourseVideoScreenState();
}

class _CourseVideoScreenState extends State<CourseVideoScreen> {
  VideoPlayerController? _controller;
  VideoProtectionController? _protection;
  bool _loading = true;
  String? _error;
  double _speed = 1.0;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final auth = context.read<AuthProvider>();
    _protection = VideoProtectionController(
      studentName: auth.user?.fullLegalName ?? context.l10n.t('mobile.roles.student'),
      nationalId: auth.user?.nationalId ?? '',
      phone: auth.user?.phone ?? '',
    );
    _protection!.addListener(() {
      if (mounted) setState(() {});
    });
    await _protection!.enable();

    try {
      _controller = await CourseVideoCache.createController(widget.url);
      await _controller!.initialize();
      if (!mounted) {
        await _controller?.dispose();
        CourseVideoCache.endStreaming(widget.url);
        return;
      }
      await _controller!.play();
      setState(() => _loading = false);
      CourseVideoCache.cacheAfterPlay(widget.url);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.t('student.noVideo');
      });
    }
  }

  @override
  void dispose() {
    CourseVideoCache.onPlaybackEnded(widget.url);
    _controller?.dispose();
    _protection?.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: GlassAppBar(title: Text(widget.title)),
      body: _loading
          ? const SkeletonVideoPlayer()
          : _error != null
              ? Center(
                  child: Text(_error!, style: TextStyle(color: AppTheme.muted)),
                )
              : Stack(
                  children: [
                    Center(
                      child: AspectRatio(
                        aspectRatio: _controller!.value.aspectRatio,
                        child: VideoPlayer(_controller!),
                      ),
                    ),
                    if (_protection != null) DynamicWatermark(controller: _protection!),
                    if (_protection != null) CastingIdentityBanner(controller: _protection!),
                    if (_protection != null)
                      ScreenshotBlockOverlay(visible: _protection!.screenshotBlocked),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: Container(
                        color: Colors.black54,
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            VideoProgressIndicator(_controller!, allowScrubbing: true),
                            Row(
                              children: [
                                ValueListenableBuilder(
                                  valueListenable: _controller!,
                                  builder: (context, value, _) => IconButton(
                                    icon: Icon(
                                      value.isPlaying ? Icons.pause : Icons.play_arrow,
                                      color: Colors.white,
                                    ),
                                    onPressed: () => value.isPlaying
                                        ? _controller!.pause()
                                        : _controller!.play(),
                                  ),
                                ),
                                PopupMenuButton<double>(
                                  initialValue: _speed,
                                  onSelected: (s) {
                                    setState(() => _speed = s);
                                    _controller!.setPlaybackSpeed(s);
                                  },
                                  itemBuilder: (_) => [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
                                      .map((s) =>
                                          PopupMenuItem(value: s, child: Text('${s}x')))
                                      .toList(),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    child: Text(
                                      '${_speed}x',
                                      style: const TextStyle(color: Colors.white),
                                    ),
                                  ),
                                ),
                                IconButton(
                                  tooltip: context.l10n.castTitle,
                                  icon: Icon(
                                    _protection!.isCasting
                                        ? Icons.cast_connected
                                        : Icons.cast_outlined,
                                    color: _protection!.isCasting
                                        ? AppTheme.accent
                                        : Colors.white,
                                  ),
                                  onPressed: () => openCourseCastScreen(
                                    context,
                                    url: widget.url,
                                    title: widget.title,
                                    protection: _protection!,
                                    positionMs: _controller!.value.position.inMilliseconds,
                                    onPause: () => _controller!.pause(),
                                    onResume: () => _controller!.play(),
                                  ),
                                ),
                              ],
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
