import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/course_video_cache.dart';
import 'package:ulearn/core/video/course_cast_service.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/video/course_cast_screen.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:video_player/video_player.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// A single item shown in the YouTube-style fullscreen playlist rail.
class CoursePlaylistItem {
  const CoursePlaylistItem({
    required this.id,
    required this.title,
    required this.canWatch,
    this.completed = false,
    this.durationLabel,
  });

  final String id;
  final String title;
  final bool canWatch;
  final bool completed;
  final String? durationLabel;
}

/// Inline / fullscreen course video player with brand logo, cast watermark,
/// completion tracking, and standard transport controls.
class CourseInlinePlayer extends StatefulWidget {
  const CourseInlinePlayer({
    super.key,
    required this.url,
    required this.title,
    this.lessonId,
    this.autoPlay = true,
    this.initiallyCompleted = false,
    this.onCompleted,
    this.freePreviewLimitSec,
    this.onPreviewLimitReached,
    this.initialPositionSec,
    this.playlist = const [],
    this.onSelectPlaylistItem,
    this.borderRadius = 14,
  });

  final String url;
  final String title;
  final String? lessonId;
  final bool autoPlay;
  final bool initiallyCompleted;
  final VoidCallback? onCompleted;
  /// When set, non-purchasers are stopped at this second and [onPreviewLimitReached] fires.
  final int? freePreviewLimitSec;
  final VoidCallback? onPreviewLimitReached;
  /// Resume playback from this second when the lesson is incomplete.
  final int? initialPositionSec;
  /// Optional lesson rail shown beside the video in fullscreen (YouTube-style).
  final List<CoursePlaylistItem> playlist;
  final ValueChanged<String>? onSelectPlaylistItem;
  /// Corner radius for the inline player frame (0 = edge-to-edge YouTube style).
  final double borderRadius;

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
  bool _lessonWasCompleted = false;
  bool _previewLimitHit = false;
  bool _didSeekResume = false;
  bool _showResumeChip = false;
  StreamSubscription<bool>? _castSub;

  @override
  void initState() {
    super.initState();
    _lessonWasCompleted = widget.initiallyCompleted;
    _completionSaved = widget.initiallyCompleted;
    MediaCacheBudget.pin(widget.url);
    _init();
  }

  @override
  void didUpdateWidget(CourseInlinePlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url || oldWidget.lessonId != widget.lessonId) {
      MediaCacheBudget.unpin(oldWidget.url);
      CourseVideoCache.onPlaybackEnded(oldWidget.url);
      MediaCacheBudget.pin(widget.url);
      _progressTimer?.cancel();
      _controller?.removeListener(_onControllerTick);
      _controller?.dispose();
      _controller = null;
      _lessonWasCompleted = widget.initiallyCompleted;
      _completionSaved = widget.initiallyCompleted;
      _showCompleteFlash = false;
      _previewLimitHit = false;
      _didSeekResume = false;
      _showResumeChip = false;
      _loading = true;
      _error = null;
      _init();
    } else if (oldWidget.initiallyCompleted != widget.initiallyCompleted) {
      _lessonWasCompleted = widget.initiallyCompleted;
      _completionSaved = widget.initiallyCompleted;
    }
  }

  void _onControllerTick() {
    // Avoid rebuilding the whole player on every frame — controls listen separately.
    _onPlaybackUpdate();
  }

  void _onPlaybackUpdate() {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    final v = c.value;
    final limit = widget.freePreviewLimitSec;
    if (limit != null && limit > 0 && !_previewLimitHit) {
      if (v.position.inSeconds >= limit) {
        _previewLimitHit = true;
        c.pause();
        c.seekTo(Duration(seconds: limit));
        widget.onPreviewLimitReached?.call();
        if (mounted) setState(() {});
        return;
      }
    }
    if (_completionSaved) return;
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
    // Completed lessons stay completed — skip saves that would regress progress.
    if (_lessonWasCompleted && !completed) return;
    try {
      final duration = c.value.duration.inSeconds;
      final position = completed && duration > 0 ? duration : c.value.position.inSeconds;
      await context.read<ApiClient>().post(
            '/api/store/lessons/${widget.lessonId}/progress',
            {
              'positionSec': position,
              'durationSec': duration,
              if (completed || _lessonWasCompleted) 'completed': true,
            },
          );
      if (completed) _lessonWasCompleted = true;
    } catch (_) {}
  }

  Future<void> _init() async {
    final auth = context.read<AuthProvider>();
    final l10n = context.l10nRead;
    _protection ??= videoProtectionFromAuth(
      auth: auth,
      fallbackName: l10n.t('mobile.roles.student'),
    )..addListener(() {
        if (mounted) setState(() {});
      });

    // Start network/file controller while refreshing protection identity.
    final controllerFuture = CourseVideoCache.createController(widget.url);
    await ensureFreshProtectionIdentity(
      auth,
      _protection!,
      l10n.t('mobile.roles.student'),
    );

    final enableFuture = _protection!.enable();
    final controller = await controllerFuture;

    if (Platform.isAndroid) {
      _castSub ??= CourseCastService.castingStream.listen((casting) {
        _protection?.setCasting(casting);
      });
    }

    try {
      await Future.wait([
        enableFuture,
        controller.initialize(),
      ]);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      _controller = controller;
      final resumeSec = widget.initialPositionSec ?? 0;
      if (!_lessonWasCompleted && resumeSec > 5 && !_didSeekResume) {
        final duration = controller.value.duration.inSeconds;
        final target = duration > 0 ? resumeSec.clamp(0, duration - 2) : resumeSec;
        if (target > 5) {
          await controller.seekTo(Duration(seconds: target));
          _didSeekResume = true;
          _showResumeChip = true;
          Future.delayed(const Duration(seconds: 4), () {
            if (mounted) setState(() => _showResumeChip = false);
          });
        }
      }
      if (widget.autoPlay) await _controller!.play();
      _controller!.addListener(_onControllerTick);
      setState(() => _loading = false);
      _startProgressTimer();
      // Quietly cache the *next* lesson; cache this one after the user leaves.
      CourseVideoCache.cacheAfterPlay(widget.url);
    } catch (_) {
      await controller.dispose();
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.t('mobile.video.playFailed');
      });
    }
  }

  Future<void> _openCast() async {
    if (_controller == null || _protection == null) return;
    final auth = context.read<AuthProvider>();
    final l10n = context.l10nRead;
    await ensureFreshProtectionIdentity(
      auth,
      _protection!,
      l10n.t('mobile.roles.student'),
    );
    if (!mounted) return;
    await openCourseCastScreen(
      context,
      url: widget.url,
      title: widget.title,
      protection: _protection!,
      lessonId: widget.lessonId,
      positionMs: _controller!.value.position.inMilliseconds,
      onPause: () => _controller?.pause(),
      onResume: () {
        if (widget.autoPlay) _controller?.play();
      },
    );
  }

  @override
  void dispose() {
    MediaCacheBudget.unpin(widget.url);
    CourseVideoCache.onPlaybackEnded(widget.url);
    _progressTimer?.cancel();
    _castSub?.cancel();
    _saveProgress();
    _controller?.removeListener(_onControllerTick);
    _controller?.dispose();
    _protection?.disable();
    super.dispose();
  }

  Future<void> _enterFullscreen() async {
    if (_controller == null || _error != null) return;
    final selectedId = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _FullscreenPlayer(
          controller: _controller!,
          protection: _protection!,
          title: widget.title,
          speed: _speed,
          videoUrl: widget.url,
          lessonId: widget.lessonId,
          playlist: widget.playlist,
          onSpeed: (s) => setState(() {
            _speed = s;
            _controller!.setPlaybackSpeed(s);
          }),
        ),
      ),
    );
    if (!mounted) return;
    if (selectedId != null &&
        selectedId.isNotEmpty &&
        selectedId != widget.lessonId) {
      widget.onSelectPlaylistItem?.call(selectedId);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(widget.borderRadius),
          child: const SkeletonVideoPlayer(),
        ),
      );
    }
    if (_error != null) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(widget.borderRadius),
          child: Container(
            color: AppTheme.card,
            child: Center(
              child: Text(_error!, style: TextStyle(color: AppTheme.muted)),
            ),
          ),
        ),
      );
    }

    final radius = widget.borderRadius;
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: GestureDetector(
        onTap: () => setState(() => _showControls = !_showControls),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: ColoredBox(
            color: Colors.black,
            child: Stack(
              fit: StackFit.expand,
              children: [
                RepaintBoundary(
                  child: Center(child: VideoPlayer(_controller!)),
                ),
                if (_protection != null) const VideoBrandLogo(markSize: 24),
                if (_protection != null) DynamicWatermark(controller: _protection!),
                if (_protection != null) CastingIdentityBanner(controller: _protection!),
                if (_protection != null)
                  ScreenshotBlockOverlay(visible: _protection!.screenshotBlocked),
                AnimatedOpacity(
                  opacity: _showControls ? 1 : 0,
                  duration: const Duration(milliseconds: 220),
                  child: ValueListenableBuilder<VideoPlayerValue>(
                    valueListenable: _controller!,
                    builder: (context, _, child) => _ControlsOverlay(
                      controller: _controller!,
                      protection: _protection,
                      speed: _speed,
                      onSpeed: (s) {
                        setState(() => _speed = s);
                        _controller!.setPlaybackSpeed(s);
                      },
                      onFullscreen: _enterFullscreen,
                      onCast: _openCast,
                    ),
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
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.check_circle_rounded, color: Colors.greenAccent),
                            const SizedBox(width: 10),
                            Text(
                              context.l10n.storeVideoCompleted,
                              style: const TextStyle(
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
                if (_previewLimitHit)
                  Container(
                    color: Colors.black.withValues(alpha: 0.72),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.lock_clock_rounded, color: AppTheme.accent, size: 40),
                        const SizedBox(height: 12),
                        Text(
                          context.l10n.t('mobile.store.previewEnded'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          context.l10n.t('mobile.store.previewEndedHint'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white70, height: 1.35),
                        ),
                      ],
                    ),
                  ),
                if (_showResumeChip)
                  Positioned(
                    top: 12,
                    left: 12,
                    child: AnimatedOpacity(
                      opacity: _showResumeChip ? 1 : 0,
                      duration: const Duration(milliseconds: 250),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.65),
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(color: AppTheme.accent.withValues(alpha: 0.5)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.history_rounded, size: 14, color: AppTheme.accent),
                            const SizedBox(width: 6),
                            Text(
                              context.l10n.t('mobile.store.resumeFrom', {
                                'time': _formatResumeTime(widget.initialPositionSec ?? 0),
                              }),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
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

  String _formatResumeTime(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    if (m <= 0) return '${s}s';
    return '${m}m ${s.toString().padLeft(2, '0')}s';
  }
}

class _ControlsOverlay extends StatelessWidget {
  const _ControlsOverlay({
    required this.controller,
    required this.protection,
    required this.speed,
    required this.onSpeed,
    required this.onFullscreen,
    required this.onCast,
  });

  final VideoPlayerController controller;
  final VideoProtectionController? protection;
  final double speed;
  final ValueChanged<double> onSpeed;
  final VoidCallback onFullscreen;
  final VoidCallback onCast;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
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
                          tooltip: protection!.isCasting
                              ? l10n.t('mobile.cast.casting')
                              : l10n.castTitle,
                          icon: Icon(
                            protection!.isCasting
                                ? Icons.cast_connected
                                : Icons.cast_outlined,
                            color: protection!.isCasting ? AppTheme.accent : Colors.white70,
                          ),
                          onPressed: onCast,
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
    required this.videoUrl,
    this.lessonId,
    this.playlist = const [],
  });

  final VideoPlayerController controller;
  final VideoProtectionController protection;
  final String title;
  final double speed;
  final ValueChanged<double> onSpeed;
  final String videoUrl;
  final String? lessonId;
  final List<CoursePlaylistItem> playlist;

  @override
  State<_FullscreenPlayer> createState() => _FullscreenPlayerState();
}

class _FullscreenPlayerState extends State<_FullscreenPlayer> {
  bool _showControls = true;
  bool _showPlaylist = true;

  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    widget.protection.addListener(_repaint);
  }

  @override
  void dispose() {
    widget.protection.removeListener(_repaint);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    super.dispose();
  }

  void _repaint() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final hasPlaylist = widget.playlist.length > 1;
    final showRail = hasPlaylist && _showPlaylist;

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: GestureDetector(
                onTap: () => setState(() => _showControls = !_showControls),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Center(
                      child: AspectRatio(
                        aspectRatio: widget.controller.value.aspectRatio == 0
                            ? 16 / 9
                            : widget.controller.value.aspectRatio,
                        child: VideoPlayer(widget.controller),
                      ),
                    ),
                    const VideoBrandLogo(markSize: 26),
                    DynamicWatermark(controller: widget.protection),
                    CastingIdentityBanner(controller: widget.protection),
                    ScreenshotBlockOverlay(
                      visible: widget.protection.screenshotBlocked,
                    ),
                    AnimatedOpacity(
                      opacity: _showControls ? 1 : 0,
                      duration: const Duration(milliseconds: 220),
                      child: ValueListenableBuilder<VideoPlayerValue>(
                        valueListenable: widget.controller,
                        builder: (context, value, _) => Column(
                          children: [
                            GlassAppBar(
                              leading: IconButton(
                                icon: const Icon(
                                  Icons.arrow_back,
                                  color: Colors.white,
                                ),
                                onPressed: () => Navigator.of(context).pop(),
                              ),
                              title: Text(
                                widget.title,
                                style: const TextStyle(color: Colors.white),
                              ),
                              actions: [
                                if (hasPlaylist)
                                  IconButton(
                                    tooltip: _showPlaylist
                                        ? context.l10n
                                            .t('mobile.store.hidePlaylist')
                                        : context.l10n
                                            .t('mobile.store.showPlaylist'),
                                    icon: Icon(
                                      _showPlaylist
                                          ? Icons.playlist_remove_outlined
                                          : Icons.playlist_play_outlined,
                                      color: Colors.white,
                                      size: 22,
                                    ),
                                    onPressed: () => setState(
                                      () => _showPlaylist = !_showPlaylist,
                                    ),
                                  ),
                                IconButton(
                                  icon: Icon(
                                    widget.protection.isCasting
                                        ? Icons.cast_connected
                                        : Icons.cast_outlined,
                                    color: widget.protection.isCasting
                                        ? AppTheme.accent
                                        : Colors.white70,
                                  ),
                                  onPressed: () => openCourseCastScreen(
                                    context,
                                    url: widget.videoUrl,
                                    title: widget.title,
                                    protection: widget.protection,
                                    lessonId: widget.lessonId,
                                    positionMs: widget
                                        .controller.value.position.inMilliseconds,
                                    onPause: () => widget.controller.pause(),
                                    onResume: () => widget.controller.play(),
                                  ),
                                ),
                              ],
                            ),
                            const Spacer(),
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                children: [
                                  VideoProgressIndicator(
                                    widget.controller,
                                    allowScrubbing: true,
                                  ),
                                  Row(
                                    children: [
                                      IconButton(
                                        icon: Icon(
                                          value.isPlaying
                                              ? Icons.pause
                                              : Icons.play_arrow,
                                          color: Colors.white,
                                          size: 32,
                                        ),
                                        onPressed: () => value.isPlaying
                                            ? widget.controller.pause()
                                            : widget.controller.play(),
                                      ),
                                      PopupMenuButton<double>(
                                        initialValue: widget.speed,
                                        onSelected: widget.onSpeed,
                                        itemBuilder: (_) =>
                                            [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
                                                .map(
                                                  (s) => PopupMenuItem(
                                                    value: s,
                                                    child: Text('${s}x'),
                                                  ),
                                                )
                                                .toList(),
                                        child: Text(
                                          '${widget.speed}x',
                                          style: const TextStyle(
                                            color: Colors.white,
                                          ),
                                        ),
                                      ),
                                      const Spacer(),
                                      if (hasPlaylist && !_showPlaylist)
                                        IconButton(
                                          tooltip: context.l10n
                                              .t('mobile.store.showPlaylist'),
                                          icon: const Icon(
                                            Icons.playlist_play_outlined,
                                            color: Colors.white,
                                            size: 22,
                                          ),
                                          onPressed: () => setState(
                                            () => _showPlaylist = true,
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
                    ),
                  ],
                ),
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 240),
              curve: Curves.easeOutCubic,
              width: showRail ? 280 : 0,
              child: showRail
                  ? _FullscreenPlaylistRail(
                      items: widget.playlist,
                      activeId: widget.lessonId,
                      onPick: (id) => Navigator.of(context).pop(id),
                      onHide: () => setState(() => _showPlaylist = false),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

class _FullscreenPlaylistRail extends StatelessWidget {
  const _FullscreenPlaylistRail({
    required this.items,
    required this.activeId,
    required this.onPick,
    required this.onHide,
  });

  final List<CoursePlaylistItem> items;
  final String? activeId;
  final ValueChanged<String> onPick;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Material(
      color: const Color(0xFF0B0B12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 4, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.t('mobile.store.playlist'),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: l10n.t('mobile.store.hidePlaylist'),
                  visualDensity: VisualDensity.compact,
                  iconSize: 18,
                  onPressed: onHide,
                  icon: const Icon(
                    Icons.chevron_right,
                    color: Colors.white70,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Colors.white12),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 6),
              itemCount: items.length,
              itemBuilder: (context, i) {
                final item = items[i];
                final active = item.id == activeId;
                return InkWell(
                  onTap: item.canWatch ? () => onPick(item.id) : null,
                  child: Container(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                    decoration: BoxDecoration(
                      color: active
                          ? AppTheme.accent.withValues(alpha: 0.16)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: active
                            ? AppTheme.accent.withValues(alpha: 0.45)
                            : Colors.white10,
                      ),
                    ),
                    child: Row(
                      children: [
                        Text(
                          '${i + 1}',
                          style: TextStyle(
                            color: active ? AppTheme.accent : Colors.white54,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: item.canWatch
                                      ? Colors.white
                                      : Colors.white38,
                                  fontWeight: active
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                  fontSize: 12.5,
                                  height: 1.25,
                                ),
                              ),
                              if (item.durationLabel != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  item.durationLabel!,
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (item.completed)
                          const Icon(
                            Icons.check_circle,
                            size: 16,
                            color: Color(0xFF22C55E),
                          )
                        else if (!item.canWatch)
                          const Icon(
                            Icons.lock_outline,
                            size: 16,
                            color: Colors.white38,
                          )
                        else if (active)
                          const Icon(
                            Icons.play_arrow_rounded,
                            size: 18,
                            color: AppTheme.accent,
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
