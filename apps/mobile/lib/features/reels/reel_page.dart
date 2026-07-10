import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:video_player/video_player.dart';

/// Single full-screen reel with overlay actions.
class ReelPage extends StatefulWidget {
  const ReelPage({
    super.key,
    required this.video,
    required this.active,
    required this.onLike,
    required this.onComment,
    this.onTeacherTap,
    this.onMore,
    this.bottomInset = 116,
  });

  final Map<String, dynamic> video;
  final bool active;
  final VoidCallback onLike;
  final VoidCallback onComment;
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
  bool _scrubMode = false;
  int _initGeneration = 0;
  bool _disposed = false;

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

  void _resumePlayback() {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    try {
      c.setVolume(_muted ? 0 : 1);
      if (!_scrubMode) c.play();
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

  void _releaseVideo({bool stash = false}) {
    _initGeneration++;
    final c = _controller;
    if (c == null) return;
    final url = widget.video['fileUrl']?.toString();
    _controller = null;
    if (url != null && url.isNotEmpty) {
      ReelVideoCache.endStreaming(url);
    }
    if (stash && url != null && url.isNotEmpty && !_disposed) {
      ReelVideoCache.stash(url, c);
    } else {
      ReelVideoCache.releaseController(c);
    }
  }

  @override
  void didUpdateWidget(ReelPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _pinActiveUrl();
      if (_controller == null) {
        final url = widget.video['fileUrl']?.toString();
        setState(() {
          _initializing = true;
          _showLoadSkeleton =
              url != null && url.isNotEmpty && !ReelVideoCache.isWarmReady(url);
        });
        _initVideo();
      } else {
        _resumePlayback();
        _recordViewIfNeeded();
      }
    } else if (!widget.active && oldWidget.active) {
      _unpinUrl(widget.video['fileUrl']?.toString());
      _scrubMode = false;
      _releaseVideo(stash: true);
      if (mounted) setState(() {});
    }
    if (oldWidget.video['id'] != widget.video['id']) {
      _unpinUrl(oldWidget.video['fileUrl']?.toString());
      _viewRecorded = false;
      _scrubMode = false;
      _releaseVideo(stash: false);
      _initializing = widget.active;
      _showLoadSkeleton = false;
      if (widget.active) {
        _pinActiveUrl();
        _initVideo();
      } else {
        _prefetchSelf();
        if (mounted) setState(() => _initializing = false);
      }
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
        await c.initialize();
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

      c.setLooping(true);
      c.setVolume(_muted ? 0 : 1);

      // Attach surface before play so the first decoded frame paints immediately.
      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        await ReelVideoCache.releaseController(c);
        return;
      }
      setState(() {
        _controller = c;
        _initializing = false;
        _showLoadSkeleton = false;
      });

      await c.play();
      _recordViewIfNeeded();

      if (_disposed || !mounted || gen != _initGeneration || !widget.active) {
        _releaseVideo(stash: false);
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
    if (_scrubMode) {
      _exitScrubMode(resume: true);
      return;
    }
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

  void _enterScrubMode() {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _scrubMode) return;
    HapticFeedback.mediumImpact();
    c.pause();
    setState(() => _scrubMode = true);
  }

  void _exitScrubMode({bool resume = true}) {
    if (!_scrubMode) return;
    setState(() => _scrubMode = false);
    if (resume && widget.active) {
      _controller?.play();
    }
  }

  void _seekRelative(int seconds) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    final max = c.value.duration;
    var target = c.value.position + Duration(seconds: seconds);
    if (target < Duration.zero) target = Duration.zero;
    if (target > max) target = max;
    c.seekTo(target);
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
    final teacherPhoto = teacher['profilePhotoUrl']?.toString();
    final title = widget.video['title']?.toString().trim() ?? '';
    final description = widget.video['description']?.toString().trim() ?? '';
    final caption = description.isNotEmpty ? description : title;
    final likes = (widget.video['likes'] as num?)?.toInt() ?? 0;
    final comments = (widget.video['commentCount'] as num?)?.toInt() ?? 0;
    final saves = (widget.video['saves'] as num?)?.toInt() ?? 0;
    final views = (widget.video['viewCount'] as num?)?.toInt() ?? 0;
    final liked = widget.video['likedByMe'] == true;
    final bottom = widget.bottomInset;

    return GestureDetector(
      onTap: _toggleMute,
      onDoubleTap: () => _handleLike(burst: true),
      onLongPressStart: (_) => _enterScrubMode(),
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

          // Hold-to-pause scrub controls
          if (_scrubMode && _controller != null && _controller!.value.isInitialized)
            Positioned(
              left: 16,
              right: 16,
              bottom: bottom + 8,
              child: AnimatedBuilder(
                animation: _controller!,
                builder: (context, _) => _ReelScrubBar(
                  controller: _controller!,
                  onSeek: _seekToFraction,
                  onBack: () => _seekRelative(-10),
                  onForward: () => _seekRelative(10),
                  onPlay: () => _exitScrubMode(resume: true),
                  formatTime: _formatTime,
                ),
              ),
            ),

          // Paused indicator (center)
          if (_scrubMode)
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

          // Right action rail
          Positioned(
            right: 10,
            bottom: bottom + 24,
            child: Column(
              children: [
                GestureDetector(
                  onTap: widget.onTeacherTap,
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: ProfileAvatar(name: name, photoUrl: teacherPhoto, size: 46),
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
                  icon: Icons.bookmark_border_rounded,
                  label: _formatCount(saves),
                  onTap: () {},
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

          // Bottom caption block — above tab bar
          Positioned(
            left: 14,
            right: 76,
            bottom: bottom,
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

class _ReelScrubBar extends StatelessWidget {
  const _ReelScrubBar({
    required this.controller,
    required this.onSeek,
    required this.onBack,
    required this.onForward,
    required this.onPlay,
    required this.formatTime,
  });

  final VideoPlayerController controller;
  final ValueChanged<double> onSeek;
  final VoidCallback onBack;
  final VoidCallback onForward;
  final VoidCallback onPlay;
  final String Function(Duration) formatTime;

  @override
  Widget build(BuildContext context) {
    final value = controller.value;
    final duration = value.duration;
    final position = value.position;
    final progress = duration.inMilliseconds > 0
        ? (position.inMilliseconds / duration.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white24),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(
                formatTime(position),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              Text(
                ' / ${formatTime(duration)}',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.65),
                  fontSize: 12,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const Spacer(),
              Text(
                context.l10n.t('mobile.reels.holdToPause'),
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 10,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              trackHeight: 3,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
              overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
              activeTrackColor: AppTheme.accent,
              inactiveTrackColor: Colors.white24,
              thumbColor: AppTheme.accent,
              overlayColor: AppTheme.accent.withValues(alpha: 0.2),
            ),
            child: Slider(
              value: progress,
              onChanged: onSeek,
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ScrubIconButton(
                icon: Icons.replay_10_rounded,
                label: '-10s',
                onTap: onBack,
              ),
              const SizedBox(width: 20),
              Material(
                color: AppTheme.accent,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onPlay,
                  child: const Padding(
                    padding: EdgeInsets.all(12),
                    child: Icon(Icons.play_arrow_rounded, color: Colors.black, size: 28),
                  ),
                ),
              ),
              const SizedBox(width: 20),
              _ScrubIconButton(
                icon: Icons.forward_10_rounded,
                label: '+10s',
                onTap: onForward,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ScrubIconButton extends StatelessWidget {
  const _ScrubIconButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 28),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 10)),
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
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.38),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white10),
            ),
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
