import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/core/video/video_playback.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:video_player/video_player.dart';
import 'package:fvp/fvp.dart';

/// Single full-screen reel with overlay actions.
class ReelPage extends StatefulWidget {
  const ReelPage({
    super.key,
    required this.video,
    required this.active,
    this.keepWarm = false,
    required this.onLike,
    required this.onComment,
    this.onSave,
    this.onTeacherTap,
    this.onMore,
    this.bottomInset = 116,
  });

  final Map<String, dynamic> video;
  final bool active;

  /// When true, keep a paused decoder alive for instant swipe-back replay.
  final bool keepWarm;

  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback? onSave;
  final VoidCallback? onTeacherTap;
  final VoidCallback? onMore;
  final double bottomInset;

  @override
  State<ReelPage> createState() => _ReelPageState();
}

class _ReelPageState extends State<ReelPage> with TickerProviderStateMixin {
  VideoPlayerController? _controller;
  bool _initializing = true;
  bool _showLoadSkeleton = false;
  bool _muted = false;
  bool _showMuteHint = false;
  late final AnimationController _likePulse;
  late final AnimationController _heartBurst;
  bool _showHeartBurst = false;
  bool _viewRecorded = false;
  bool _holdPaused = false;
  bool _scrubbing = false;
  int _initGeneration = 0;
  bool _disposed = false;
  DateTime? _bufferingSince;
  bool _stallRecovering = false;
  bool _loopingInProgress = false;

  Future<void> _recordViewIfNeeded() async {
    if (_viewRecorded || !widget.active || !mounted) return;
    final id = widget.video['id']?.toString();
    if (id == null) return;
    _viewRecorded = true;
    try {
      await context.read<ApiClient>().post('/api/store/short-videos/$id/view', {});
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    _likePulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 320),
      lowerBound: 0.85,
      upperBound: 1.25,
    );
    _heartBurst = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..addStatusListener((s) {
        if (s == AnimationStatus.completed && mounted) {
          setState(() => _showHeartBurst = false);
        }
      });
    if (widget.active) {
      _pinActiveUrl();
      _initVideo();
    } else {
      _initializing = false;
      _prefetchSelf();
    }
  }

  void _pinActiveUrl() {
    final url = widget.video['fileUrl']?.toString();
    if (url != null && url.isNotEmpty) MediaCacheBudget.pin(url);
  }

  void _unpinUrl(String? url) {
    if (url != null && url.isNotEmpty) MediaCacheBudget.unpin(url);
  }

  void _prefetchSelf() {
    final url = widget.video['fileUrl']?.toString();
    if (url != null && url.isNotEmpty) ReelVideoCache.prefetch(url);
  }

  void _resumePlayback({bool fromStart = false}) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    try {
      c.setVolume(_muted ? 0 : 1);
      if (fromStart) {
        // Accurate seek (fastSeek disabled globally) for clean replay.
        c.seekTo(Duration.zero);
      }
      if (!_scrubbing && !_holdPaused) c.play();
    } catch (_) {
      _releaseVideo(stash: false);
      if (mounted) {
        setState(() {
          _initializing = true;
          _showLoadSkeleton = true;
        });
        _initVideo();
      }
    }
  }

  void _pauseKeepWarm() {
    final c = _controller;
    if (c == null) return;
    try {
      c.pause();
      c.setVolume(0);
    } catch (_) {}
    final url = widget.video['fileUrl']?.toString();
    // Free bandwidth flag so disk cache can fill while paused nearby.
    if (url != null && url.isNotEmpty) {
      ReelVideoCache.endStreaming(url);
      unawaited(ReelVideoCache.prefetch(url));
    }
  }

  void _releaseVideo({bool stash = false}) {
    _initGeneration++;
    _bufferingSince = null;
    final c = _controller;
    if (c == null) return;
    c.removeListener(_onPlaybackTick);
    final url = widget.video['fileUrl']?.toString();
    _controller = null;
    if (url != null && url.isNotEmpty) {
      ReelVideoCache.endStreaming(url);
    }
    if (stash && url != null && url.isNotEmpty && !_disposed) {
      ReelVideoCache.stash(url, c);
      unawaited(ReelVideoCache.prefetch(url));
    } else {
      ReelVideoCache.releaseController(c);
    }
  }

  void _onPlaybackTick() {
    final c = _controller;
    if (c == null || !widget.active || _disposed || _stallRecovering) return;
    final v = c.value;
    if (!v.isInitialized) return;

    // Manual loop: native setLooping often leaves position at EOF so the
    // progress bar stays full. Seek to 0 + play resets UI like TikTok/Reels.
    if (!_scrubbing && !_holdPaused && !_loopingInProgress) {
      final duration = v.duration;
      if (duration > Duration.zero) {
        final atEnd = v.isCompleted ||
            v.position >= duration - const Duration(milliseconds: 120);
        if (atEnd) {
          unawaited(_restartLoop());
          return;
        }
      }
    }

    if (v.isBuffering && v.isPlaying) {
      _bufferingSince ??= DateTime.now();
      final stalled = DateTime.now().difference(_bufferingSince!);
      // Long buffer stall → recreate over network once (often a bad cache slice).
      if (stalled > const Duration(seconds: 4)) {
        _stallRecovering = true;
        final url = widget.video['fileUrl']?.toString();
        _releaseVideo(stash: false);
        if (url != null && url.isNotEmpty) {
          VideoPathIndex.remove(url);
        }
        if (mounted && widget.active) {
          setState(() {
            _initializing = true;
            _showLoadSkeleton = true;
          });
          _initVideo().whenComplete(() => _stallRecovering = false);
        } else {
          _stallRecovering = false;
        }
      }
      return;
    }
    _bufferingSince = null;
  }

  Future<void> _restartLoop() async {
    if (_loopingInProgress || _disposed || !widget.active) return;
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    _loopingInProgress = true;
    try {
      await c.pause();
      await c.seekTo(Duration.zero);
      // Ensure listeners / slider see 0 before play resumes.
      if (mounted) setState(() {});
      if (_disposed || !widget.active || !_controller!.value.isInitialized) {
        return;
      }
      if (!_scrubbing && !_holdPaused) {
        c.setVolume(_muted ? 0 : 1);
        await c.play();
      }
    } catch (_) {
      // If seek/play fails, try a full re-init once.
      if (mounted && widget.active) {
        _releaseVideo(stash: false);
        setState(() {
          _initializing = true;
          _showLoadSkeleton = true;
        });
        await _initVideo();
      }
    } finally {
      _loopingInProgress = false;
    }
  }

  @override
  void didUpdateWidget(ReelPage oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (widget.active && !oldWidget.active) {
      _pinActiveUrl();
      final url = widget.video['fileUrl']?.toString();
      if (url != null && url.isNotEmpty) {
        ReelVideoCache.beginStreaming(url);
      }
      if (_controller != null && _controller!.value.isInitialized) {
        // Instant replay — decoder was kept warm while nearby.
        final nearEnd = _controller!.value.duration.inMilliseconds > 0 &&
            _controller!.value.position >=
                _controller!.value.duration - const Duration(milliseconds: 400);
        _resumePlayback(fromStart: nearEnd);
        _recordViewIfNeeded();
      } else if (_controller == null) {
        setState(() {
          _initializing = true;
          _showLoadSkeleton =
              url != null && url.isNotEmpty && !ReelVideoCache.isWarmReady(url);
        });
        _initVideo();
      }
    } else if (!widget.active && oldWidget.active) {
      _unpinUrl(widget.video['fileUrl']?.toString());
      _scrubbing = false;
      _holdPaused = false;
      _stallRecovering = false;
      _loopingInProgress = false;
      if (widget.keepWarm && _controller != null) {
        // Stay decoded & paused — swipe-back must not re-buffer.
        _pauseKeepWarm();
      } else {
        _releaseVideo(stash: true);
      }
      if (mounted) setState(() {});
    }

    // Entered ±1 window while idle — pre-decode from disk only (no 2nd stream).
    if (widget.keepWarm &&
        !oldWidget.keepWarm &&
        !widget.active &&
        _controller == null) {
      unawaited(_prewarmFromDisk());
    }

    // Left the ±1 window — free the decoder.
    if (!widget.keepWarm && oldWidget.keepWarm && !widget.active) {
      _releaseVideo(stash: false);
      if (mounted) setState(() {});
    }

    if (oldWidget.video['id'] != widget.video['id']) {
      _unpinUrl(oldWidget.video['fileUrl']?.toString());
      _viewRecorded = false;
      _scrubbing = false;
      _holdPaused = false;
      _stallRecovering = false;
      _releaseVideo(stash: false);
      _initializing = widget.active;
      _showLoadSkeleton = false;
      if (widget.active) {
        _pinActiveUrl();
        _initVideo();
      } else {
        _prefetchSelf();
        if (widget.keepWarm) unawaited(_prewarmFromDisk());
        if (mounted) setState(() => _initializing = false);
      }
    }
  }

  /// Instant swipe-in when the file is already on disk — never opens a second
  /// network stream beside the active reel.
  Future<void> _prewarmFromDisk() async {
    final gen = _initGeneration;
    final url = widget.video['fileUrl']?.toString();
    if (url == null || url.isEmpty) return;
    if (widget.active || _controller != null || _disposed) return;

    if (!await ReelVideoCache.isFileCached(url)) {
      unawaited(ReelVideoCache.prefetch(url));
      return;
    }
    if (_disposed || gen != _initGeneration || widget.active || _controller != null) {
      return;
    }

    VideoPlayerController? c;
    try {
      c = await ReelVideoCache.createController(url);
      if (_disposed || gen != _initGeneration || widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      if (!c.value.isInitialized) {
        await VideoPlayback.initializeSafely(c, urlForCacheInvalidation: url);
      }
      if (_disposed || gen != _initGeneration || widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      c.setLooping(false);
      c.setVolume(0);
      try {
        c.setBufferRange(min: 2000, max: 10000, drop: false);
      } catch (_) {}
      await c.pause();
      // Not actively streaming — allow disk cache maintenance.
      ReelVideoCache.endStreaming(url);
      if (!mounted || _disposed || widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      c.addListener(_onPlaybackTick);
      setState(() {
        _controller = c;
        _initializing = false;
        _showLoadSkeleton = false;
      });
    } catch (_) {
      if (c != null) await ReelVideoCache.releaseController(c);
    }
  }

  Future<void> _initVideo() async {
    final gen = ++_initGeneration;
    final url = widget.video['fileUrl']?.toString();
    if (url == null || url.isEmpty) {
      if (mounted && gen == _initGeneration) {
        setState(() {
          _initializing = false;
          _showLoadSkeleton = false;
        });
      }
      return;
    }
    if (!widget.active) {
      _prefetchSelf();
      if (mounted && gen == _initGeneration) {
        setState(() {
          _initializing = false;
          _showLoadSkeleton = false;
        });
      }
      return;
    }

    final showSkeleton = await ReelVideoCache.shouldShowLoadSkeleton(url);
    if (mounted && gen == _initGeneration && widget.active) {
      setState(() => _showLoadSkeleton = showSkeleton);
    }

    VideoPlayerController? c;
    try {
      c = await ReelVideoCache.createController(url);
      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }

      if (!c.value.isInitialized) {
        try {
          await VideoPlayback.initializeSafely(
            c,
            urlForCacheInvalidation: url,
          );
        } catch (_) {
          await ReelVideoCache.releaseController(c);
          // Retry once over the network (drop bad disk cache).
          VideoPathIndex.remove(url);
          c = VideoPlayback.create(url);
          if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
            await ReelVideoCache.releaseController(c);
            return;
          }
          await VideoPlayback.initializeSafely(c, urlForCacheInvalidation: url);
        }
      }
      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      if (c.value.hasError) {
        await ReelVideoCache.releaseController(c);
        if (mounted && gen == _initGeneration) {
          setState(() {
            _initializing = false;
            _showLoadSkeleton = false;
          });
        }
        return;
      }

      c.setLooping(false);
      c.setVolume(_muted ? 0 : 1);
      try {
        await c.setPlaybackSpeed(1.0);
      } catch (_) {}
      // Smoother progressive MP4: wait for ~2s buffered, allow up to ~10s.
      try {
        c.setBufferRange(min: 2000, max: 10000, drop: false);
      } catch (_) {}

      // Attach surface before play so the first decoded frame paints immediately.
      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      c.addListener(_onPlaybackTick);
      setState(() {
        _controller = c;
        _initializing = false;
        _showLoadSkeleton = false;
      });

      await c.play();
      _bufferingSince = null;
      _recordViewIfNeeded();

      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        if (widget.keepWarm) {
          _pauseKeepWarm();
        } else {
          _releaseVideo(stash: false);
        }
        return;
      }
    } catch (_) {
      if (c != null) await ReelVideoCache.releaseController(c);
      if (mounted && gen == _initGeneration) {
        setState(() {
          _initializing = false;
          _showLoadSkeleton = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _initGeneration++;
    _unpinUrl(widget.video['fileUrl']?.toString());
    _releaseVideo(stash: false);
    _likePulse.dispose();
    _heartBurst.dispose();
    super.dispose();
  }

  void _toggleMute() {
    if (_holdPaused || _scrubbing) return;
    setState(() {
      _muted = !_muted;
      _showMuteHint = true;
      _controller?.setVolume(_muted ? 0 : 1);
    });
    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _showMuteHint = false);
    });
  }

  void _handleLike({bool burst = false}) {
    HapticFeedback.lightImpact();
    _likePulse.forward(from: 0).then((_) => _likePulse.reverse());
    if (burst) {
      setState(() => _showHeartBurst = true);
      _heartBurst.forward(from: 0);
    }
    widget.onLike();
  }

  void _onHoldStart(LongPressStartDetails _) {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _holdPaused) return;
    HapticFeedback.lightImpact();
    c.pause();
    setState(() => _holdPaused = true);
  }

  void _onHoldEnd(LongPressEndDetails _) {
    if (!_holdPaused) return;
    setState(() => _holdPaused = false);
    if (widget.active) _controller?.play();
  }

  void _seekToFraction(double fraction) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    final max = c.value.duration;
    if (max <= Duration.zero) return;
    c.seekTo(Duration(milliseconds: (max.inMilliseconds * fraction).round()));
  }

  String _formatTime(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    if (h > 0) return '$h:$m:$s';
    return '$m:$s';
  }

  String _formatCount(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  String _teacherName(Map<String, dynamic> teacher, BuildContext context) {
    final direct = teacher['name']?.toString();
    if (direct != null && direct.trim().isNotEmpty) return direct.trim();
    final user = teacher['user'] as Map<String, dynamic>?;
    final legal = user?['fullLegalName']?.toString();
    if (legal != null && legal.trim().isNotEmpty) return legal.trim();
    return context.l10n.t('student.teacher');
  }

  Widget _buildPoster() {
    final thumb = widget.video['thumbnailUrl']?.toString();
    if (thumb != null && thumb.isNotEmpty) {
      return CachedImage(url: thumb, fit: BoxFit.cover);
    }
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.35),
            AppTheme.card,
            Colors.black,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
    );
  }

  Widget _buildVideoLayer() {
    if (_initializing && widget.active && _showLoadSkeleton) {
      return Stack(
        fit: StackFit.expand,
        children: [
          _buildPoster(),
          const Center(child: SkeletonCircle(size: 48)),
        ],
      );
    }
    if (_initializing && widget.active) {
      return _buildPoster();
    }
    final c = _controller;
    if (c != null && c.value.isInitialized) {
      return _StableReelSurface(controller: c);
    }
    return _buildPoster();
  }

  @override
  Widget build(BuildContext context) {
    final teacher = widget.video['teacher'] as Map<String, dynamic>? ?? {};
    final name = _teacherName(teacher, context);
    final level = teacher['level']?.toString() ?? '';
    final teacherPhoto = resolveProfilePhotoUrl(teacher);
    final title = widget.video['title']?.toString().trim() ?? '';
    final description = widget.video['description']?.toString().trim() ?? '';
    final caption = description.isNotEmpty ? description : title;
    final likes = (widget.video['likes'] as num?)?.toInt() ?? 0;
    final comments = (widget.video['commentCount'] as num?)?.toInt() ?? 0;
    final saves = (widget.video['saves'] as num?)?.toInt() ?? 0;
    final views = (widget.video['viewCount'] as num?)?.toInt() ?? 0;
    final liked = widget.video['likedByMe'] == true;
    final saved = widget.video['savedByMe'] == true;
    final bottom = widget.bottomInset;

    return GestureDetector(
      onTap: _toggleMute,
      onDoubleTap: () => _handleLike(burst: true),
      onLongPressStart: _onHoldStart,
      onLongPressEnd: _onHoldEnd,
      onLongPressCancel: () {
        if (_holdPaused) {
          setState(() => _holdPaused = false);
          if (widget.active) _controller?.play();
        }
      },
      child: Stack(
        fit: StackFit.expand,
        children: [
          _buildVideoLayer(),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.black.withValues(alpha: 0.35),
                  Colors.transparent,
                  Colors.transparent,
                  Colors.black.withValues(alpha: 0.82),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: const [0, 0.18, 0.55, 1],
              ),
            ),
          ),

          // Double-tap heart burst
          if (_showHeartBurst)
            Center(
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.4, end: 1.15).animate(
                  CurvedAnimation(parent: _heartBurst, curve: Curves.easeOutBack),
                ),
                child: FadeTransition(
                  opacity: Tween<double>(begin: 1, end: 0).animate(
                    CurvedAnimation(
                      parent: _heartBurst,
                      curve: const Interval(0.35, 1, curve: Curves.easeOut),
                    ),
                  ),
                  child: Icon(
                    Icons.favorite_rounded,
                    size: 96,
                    color: Colors.redAccent.withValues(alpha: 0.92),
                  ),
                ),
              ),
            ),

          // Mute hint
          AnimatedOpacity(
            opacity: _showMuteHint ? 1 : 0,
            duration: const Duration(milliseconds: 200),
            child: Center(
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white24),
                ),
                child: Icon(
                  _muted ? Icons.volume_off_rounded : Icons.volume_up_rounded,
                  color: Colors.white,
                  size: 32,
                ),
              ),
            ),
          ),

          // Hold-to-pause indicator
          if (_holdPaused)
            Center(
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white24),
                ),
                child: const Icon(Icons.pause_rounded, color: Colors.white, size: 40),
              ),
            ),

          // Slim glass progress above bottom nav (timer only while scrubbing)
          if (_controller != null && _controller!.value.isInitialized)
            Positioned(
              left: 14,
              right: 14,
              // Sit above the floating glass tab bar, nudged down 6px.
              bottom: bottom - 36 + 35 - 6,
              child: AnimatedBuilder(
                animation: _controller!,
                builder: (context, _) => _GlassProgressBar(
                  controller: _controller!,
                  formatTime: _formatTime,
                  showTimer: _scrubbing,
                  onSeekStart: () {
                    setState(() => _scrubbing = true);
                    _controller?.pause();
                  },
                  onSeek: _seekToFraction,
                  onSeekEnd: () {
                    setState(() => _scrubbing = false);
                    if (widget.active && !_holdPaused) {
                      _controller?.play();
                    }
                  },
                ),
              ),
            ),

          // Right action rail
          Positioned(
            right: 10,
            bottom: bottom + 28,
            child: Column(
              children: [
                GestureDetector(
                  onTap: widget.onTeacherTap,
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: ProfileAvatar(
                      name: name,
                      photoUrl: teacherPhoto,
                      size: 46,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                ScaleTransition(
                  scale: _likePulse,
                  child: _ActionButton(
                    icon: liked ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                    label: _formatCount(likes),
                    color: liked ? Colors.redAccent : Colors.white,
                    onTap: () => _handleLike(),
                  ),
                ),
                const SizedBox(height: 16),
                _ActionButton(
                  icon: Icons.mode_comment_rounded,
                  label: _formatCount(comments),
                  onTap: widget.onComment,
                ),
                const SizedBox(height: 16),
                _ActionButton(
                  icon: saved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
                  label: _formatCount(saves),
                  color: saved ? AppTheme.accent : Colors.white,
                  onTap: () {
                    HapticFeedback.selectionClick();
                    widget.onSave?.call();
                  },
                ),
                const SizedBox(height: 16),
                _ActionButton(
                  icon: Icons.visibility_outlined,
                  label: _formatCount(views),
                  onTap: () {},
                ),
                if (widget.onMore != null) ...[
                  const SizedBox(height: 16),
                  _ActionButton(
                    icon: Icons.more_horiz_rounded,
                    label: context.l10n.reelsMore,
                    onTap: widget.onMore!,
                  ),
                ],
              ],
            ),
          ),

          // Bottom caption block — above progress + tab bar
          Positioned(
            left: 14,
            right: 76,
            bottom: bottom + 24,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: widget.onTeacherTap,
                  behavior: HitTestBehavior.opaque,
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                            shadows: [
                              Shadow(color: Colors.black54, blurRadius: 8),
                            ],
                          ),
                        ),
                      ),
                      if (level.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppTheme.primary.withValues(alpha: 0.65),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            level.replaceAll('_', ' '),
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (title.isNotEmpty && description.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 6)],
                    ),
                  ),
                ],
                if (caption.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    caption,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.95),
                      fontSize: 13.5,
                      height: 1.35,
                      fontWeight: FontWeight.w400,
                      shadows: const [Shadow(color: Colors.black87, blurRadius: 10)],
                    ),
                  ),
                ],
                if (widget.onTeacherTap != null) ...[
                  const SizedBox(height: 10),
                  GestureDetector(
                    onTap: widget.onTeacherTap,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(color: Colors.white30),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.storefront_outlined, color: AppTheme.accent, size: 15),
                          const SizedBox(width: 6),
                          Text(
                            context.l10n.navCourses,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GlassProgressBar extends StatelessWidget {
  const _GlassProgressBar({
    required this.controller,
    required this.formatTime,
    required this.showTimer,
    required this.onSeek,
    required this.onSeekStart,
    required this.onSeekEnd,
  });

  final VideoPlayerController controller;
  final String Function(Duration) formatTime;
  final bool showTimer;
  final ValueChanged<double> onSeek;
  final VoidCallback onSeekStart;
  final VoidCallback onSeekEnd;

  @override
  Widget build(BuildContext context) {
    final value = controller.value;
    final duration = value.duration;
    var position = value.position;
    // After EOF, before our manual loop seek lands, don't paint a stuck full bar.
    if (duration > Duration.zero &&
        (value.isCompleted || position >= duration)) {
      position = Duration.zero;
    }
    final progress = duration.inMilliseconds > 0
        ? (position.inMilliseconds / duration.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AnimatedOpacity(
          opacity: showTimer ? 1 : 0,
          duration: const Duration(milliseconds: 160),
          child: IgnorePointer(
            ignoring: !showTimer,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Row(
                children: [
                  Text(
                    formatTime(position),
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      fontFeatures: const [FontFeature.tabularFigures()],
                      shadows: const [Shadow(color: Colors.black54, blurRadius: 5)],
                    ),
                  ),
                  Text(
                    ' / ${formatTime(duration)}',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 10,
                      fontFeatures: const [FontFeature.tabularFigures()],
                      shadows: const [Shadow(color: Colors.black54, blurRadius: 5)],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (showTimer) const SizedBox(height: 2),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 1.2,
            thumbShape: RoundSliderThumbShape(
              enabledThumbRadius: showTimer ? 4 : 2.5,
            ),
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 10),
            activeTrackColor: Colors.white.withValues(alpha: 0.95),
            inactiveTrackColor: Colors.white.withValues(alpha: 0.22),
            thumbColor: Colors.white,
            overlayColor: AppTheme.accent.withValues(alpha: 0.16),
          ),
          child: SizedBox(
            height: 16,
            child: Slider(
              value: progress,
              onChangeStart: (_) => onSeekStart(),
              onChanged: onSeek,
              onChangeEnd: (_) => onSeekEnd(),
            ),
          ),
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = Colors.white,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        children: [
          GlassCircle(
            child: Icon(icon, color: color, size: 26),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              shadows: [Shadow(color: Colors.black54, blurRadius: 4)],
            ),
          ),
        ],
      ),
    );
  }
}

class SkeletonReelPage extends StatelessWidget {
  const SkeletonReelPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: Container(
        color: AppTheme.card,
        alignment: Alignment.center,
        child: const SkeletonCircle(size: 56),
      ),
    );
  }
}

/// Isolates the video texture from overlay rebuilds (likes, mute, scrub).
class _StableReelSurface extends StatelessWidget {
  const _StableReelSurface({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    final size = controller.value.size;
    final w = size.width <= 0 ? 9.0 : size.width;
    final h = size.height <= 0 ? 16.0 : size.height;
    return RepaintBoundary(
      child: ColoredBox(
        color: Colors.black,
        child: FittedBox(
          fit: BoxFit.cover,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: w,
            height: h,
            child: VideoPlayer(controller),
          ),
        ),
      ),
    );
  }
}
