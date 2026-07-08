import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:video_player/video_player.dart';

/// Inline / fullscreen course video player with brand logo, cast watermark,
/// completion tracking, and standard transport controls.
class CourseInlinePlayer extends StatefulWidget {
  const CourseInlinePlayer({
    super.key,
    required this.url,
    required this.title,
    this.lessonId,
    this.autoPlay = true,
    this.onCompleted,
  });

  final String url;
  final String title;
  final String? lessonId;
  final bool autoPlay;
  final VoidCallback? onCompleted;

  @override
  State<CourseInlinePlayer> createState() => _CourseInlinePlayerState();
}

class _CourseInlinePlayerState extends State<CourseInlinePlayer> {
  VideoPlayerController? _controller;
  VideoProtectionController? _protection;
  bool _loading = true;
  String? _error;
  double _speed = 1.0;
  bool _showControls = true;
  Timer? _progressTimer;
  bool _completionSaved = false;
  bool _showCompleteFlash = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void didUpdateWidget(CourseInlinePlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url || oldWidget.lessonId != widget.lessonId) {
      _progressTimer?.cancel();
      _controller?.removeListener(_onControllerTick);
      _controller?.dispose();
      _controller = null;
      _completionSaved = false;
      _showCompleteFlash = false;
      _loading = true;
      _error = null;
      _init();
    }
  }

  void _onControllerTick() {
    if (mounted) setState(() {});
    _onPlaybackUpdate();
  }

  void _onPlaybackUpdate() {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _completionSaved) return;
    final v = c.value;
    final duration = v.duration.inSeconds;
    if (duration <= 0) return;
    final nearEnd = v.isCompleted || v.position.inSeconds >= duration - 2;
    if (nearEnd) {
      _completionSaved = true;
      _saveProgress(completed: true).then((_) {
        if (!mounted) return;
        setState(() => _showCompleteFlash = true);
        widget.onCompleted?.call();
        Future.delayed(const Duration(milliseconds: 1400), () {
          if (mounted) setState(() => _showCompleteFlash = false);
        });
      });
    }
  }

  void _startProgressTimer() {
    _progressTimer?.cancel();
    if (widget.lessonId == null) return;
    _progressTimer = Timer.periodic(const Duration(seconds: 10), (_) => _saveProgress());
  }

  Future<void> _saveProgress({bool completed = false}) async {
    final c = _controller;
    if (c == null || !c.value.isInitialized || widget.lessonId == null) return;
    try {
      final duration = c.value.duration.inSeconds;
      final position = completed && duration > 0 ? duration : c.value.position.inSeconds;
      await context.read<ApiClient>().post(
            '/api/store/lessons/${widget.lessonId}/progress',
            {
              'positionSec': position,
              'durationSec': duration,
              if (completed) 'completed': true,
            },
          );
    } catch (_) {}
  }

  Future<void> _init() async {
    final auth = context.read<AuthProvider>();
    _protection ??= VideoProtectionController(
      studentName: auth.user?.fullLegalName ?? 'Student',
      userId: auth.user?.id ?? 'unknown',
      phone: auth.user?.phone ?? '',
    )..addListener(() {
        if (mounted) setState(() {});
      });
    await _protection!.enable();

    try {
      _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
      await _controller!.initialize();
      if (!mounted) return;
      if (widget.autoPlay) await _controller!.play();
      _controller!.addListener(_onControllerTick);
      setState(() => _loading = false);
      _startProgressTimer();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not play this video';
      });
    }
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    _saveProgress();
    _controller?.removeListener(_onControllerTick);
    _controller?.dispose();
    _protection?.disable();
    super.dispose();
  }

  Future<void> _enterFullscreen() async {
    if (_controller == null || _error != null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _FullscreenPlayer(
          controller: _controller!,
          protection: _protection!,
          title: widget.title,
          speed: _speed,
          onSpeed: (s) => setState(() {
            _speed = s;
            _controller!.setPlaybackSpeed(s);
          }),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const AspectRatio(aspectRatio: 16 / 9, child: SkeletonVideoPlayer());
    }
    if (_error != null) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: Container(
          color: AppTheme.card,
          child: Center(
            child: Text(_error!, style: const TextStyle(color: AppTheme.muted)),
          ),
        ),
      );
    }

    return AspectRatio(
      aspectRatio: _controller!.value.aspectRatio.clamp(1.0, 16 / 9),
      child: GestureDetector(
        onTap: () => setState(() => _showControls = !_showControls),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: ColoredBox(
            color: Colors.black,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Center(child: VideoPlayer(_controller!)),
                if (_protection != null) const VideoBrandLogo(markSize: 24),
                if (_protection != null) DynamicWatermark(controller: _protection!),
                if (_protection != null)
                  ScreenshotBlockOverlay(visible: _protection!.screenshotBlocked),
                AnimatedOpacity(
                  opacity: _showControls ? 1 : 0,
                  duration: const Duration(milliseconds: 220),
                  child: _ControlsOverlay(
                    controller: _controller!,
                    protection: _protection,
                    speed: _speed,
                    onSpeed: (s) {
                      setState(() => _speed = s);
                      _controller!.setPlaybackSpeed(s);
                    },
                    onFullscreen: _enterFullscreen,
                  ),
                ),
                AnimatedOpacity(
                  opacity: _showCompleteFlash ? 1 : 0,
                  duration: const Duration(milliseconds: 280),
                  child: IgnorePointer(
                    child: Container(
                      color: Colors.black54,
                      alignment: Alignment.center,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                        decoration: BoxDecoration(
                          color: Colors.green.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.greenAccent.withValues(alpha: 0.6)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.check_circle_rounded, color: Colors.greenAccent),
                            SizedBox(width: 10),
                            Text(
                              'Completed',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 16,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ControlsOverlay extends StatelessWidget {
  const _ControlsOverlay({
    required this.controller,
    required this.protection,
    required this.speed,
    required this.onSpeed,
    required this.onFullscreen,
  });

  final VideoPlayerController controller;
  final VideoProtectionController? protection;
  final double speed;
  final ValueChanged<double> onSpeed;
  final VoidCallback onFullscreen;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.transparent, Colors.black.withValues(alpha: 0.85)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 24, 8, 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  VideoProgressIndicator(controller, allowScrubbing: true),
                  Row(
                    children: [
                      IconButton(
                        icon: Icon(
                          controller.value.isPlaying ? Icons.pause : Icons.play_arrow,
                          color: Colors.white,
                        ),
                        onPressed: () => controller.value.isPlaying
                            ? controller.pause()
                            : controller.play(),
                      ),
                      PopupMenuButton<double>(
                        initialValue: speed,
                        onSelected: onSpeed,
                        itemBuilder: (_) => [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
                            .map((s) => PopupMenuItem(value: s, child: Text('${s}x')))
                            .toList(),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Text('${speed}x', style: const TextStyle(color: Colors.white)),
                        ),
                      ),
                      const Spacer(),
                      if (protection != null)
                        IconButton(
                          tooltip: protection!.isCasting ? 'Casting on' : 'Cast to screen',
                          icon: Icon(
                            protection!.isCasting
                                ? Icons.cast_connected
                                : Icons.cast_outlined,
                            color: protection!.isCasting ? AppTheme.accent : Colors.white70,
                          ),
                          onPressed: () =>
                              protection!.setCasting(!protection!.isCasting),
                        ),
                      IconButton(
                        icon: const Icon(Icons.fullscreen, color: Colors.white),
                        onPressed: onFullscreen,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _FullscreenPlayer extends StatefulWidget {
  const _FullscreenPlayer({
    required this.controller,
    required this.protection,
    required this.title,
    required this.speed,
    required this.onSpeed,
  });

  final VideoPlayerController controller;
  final VideoProtectionController protection;
  final String title;
  final double speed;
  final ValueChanged<double> onSpeed;

  @override
  State<_FullscreenPlayer> createState() => _FullscreenPlayerState();
}

class _FullscreenPlayerState extends State<_FullscreenPlayer> {
  bool _showControls = true;

  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    widget.protection.addListener(_repaint);
    widget.controller.addListener(_repaint);
  }

  @override
  void dispose() {
    widget.protection.removeListener(_repaint);
    widget.controller.removeListener(_repaint);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    super.dispose();
  }

  void _repaint() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: GestureDetector(
          onTap: () => setState(() => _showControls = !_showControls),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Center(
                child: AspectRatio(
                  aspectRatio: widget.controller.value.aspectRatio,
                  child: VideoPlayer(widget.controller),
                ),
              ),
              const VideoBrandLogo(markSize: 26),
              DynamicWatermark(controller: widget.protection),
              ScreenshotBlockOverlay(visible: widget.protection.screenshotBlocked),
              AnimatedOpacity(
                opacity: _showControls ? 1 : 0,
                duration: const Duration(milliseconds: 220),
                child: Column(
                  children: [
                    AppBar(
                      backgroundColor: Colors.black54,
                      leading: IconButton(
                        icon: const Icon(Icons.arrow_back, color: Colors.white),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                      title: Text(widget.title, style: const TextStyle(color: Colors.white)),
                      actions: [
                        IconButton(
                          icon: Icon(
                            widget.protection.isCasting
                                ? Icons.cast_connected
                                : Icons.cast_outlined,
                            color: widget.protection.isCasting
                                ? AppTheme.accent
                                : Colors.white70,
                          ),
                          onPressed: () => widget.protection
                              .setCasting(!widget.protection.isCasting),
                        ),
                      ],
                    ),
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          VideoProgressIndicator(widget.controller, allowScrubbing: true),
                          Row(
                            children: [
                              IconButton(
                                icon: Icon(
                                  widget.controller.value.isPlaying
                                      ? Icons.pause
                                      : Icons.play_arrow,
                                  color: Colors.white,
                                  size: 32,
                                ),
                                onPressed: () => widget.controller.value.isPlaying
                                    ? widget.controller.pause()
                                    : widget.controller.play(),
                              ),
                              PopupMenuButton<double>(
                                initialValue: widget.speed,
                                onSelected: widget.onSpeed,
                                itemBuilder: (_) => [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
                                    .map((s) =>
                                        PopupMenuItem(value: s, child: Text('${s}x')))
                                    .toList(),
                                child: Text(
                                  '${widget.speed}x',
                                  style: const TextStyle(color: Colors.white),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
