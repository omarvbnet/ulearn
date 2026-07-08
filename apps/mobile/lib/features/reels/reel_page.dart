import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
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
    this.bottomInset = 88,
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
  bool _muted = false;
  bool _showMuteHint = false;
  late final AnimationController _likePulse;
  late final AnimationController _heartBurst;
  bool _showHeartBurst = false;

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
    _initVideo();
  }

  @override
  void didUpdateWidget(ReelPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _controller?.play();
    } else if (!widget.active && oldWidget.active) {
      _controller?.pause();
    }
    if (oldWidget.video['id'] != widget.video['id']) {
      _controller?.dispose();
      _controller = null;
      _initializing = true;
      _initVideo();
    }
  }

  Future<void> _initVideo() async {
    final url = widget.video['fileUrl']?.toString();
    if (url == null || url.isEmpty) {
      if (mounted) setState(() => _initializing = false);
      return;
    }
    try {
      final c = await ReelVideoCache.createController(url);
      await c.initialize();
      c.setLooping(true);
      c.setVolume(_muted ? 0 : 1);
      if (widget.active) await c.play();
      if (!mounted) {
        c.dispose();
        return;
      }
      setState(() {
        _controller = c;
        _initializing = false;
      });
    } catch (_) {
      if (mounted) setState(() => _initializing = false);
    }
  }

  @override
  void dispose() {
    _likePulse.dispose();
    _heartBurst.dispose();
    _controller?.dispose();
    super.dispose();
  }

  void _toggleMute() {
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

  String _formatCount(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  String _teacherName(Map<String, dynamic> teacher) {
    final direct = teacher['name']?.toString();
    if (direct != null && direct.trim().isNotEmpty) return direct.trim();
    final user = teacher['user'] as Map<String, dynamic>?;
    final legal = user?['fullLegalName']?.toString();
    if (legal != null && legal.trim().isNotEmpty) return legal.trim();
    return 'Teacher';
  }

  @override
  Widget build(BuildContext context) {
    final teacher = widget.video['teacher'] as Map<String, dynamic>? ?? {};
    final name = _teacherName(teacher);
    final level = teacher['level']?.toString() ?? '';
    final teacherPhoto = teacher['profilePhotoUrl']?.toString();
    final title = widget.video['title']?.toString().trim() ?? '';
    final description = widget.video['description']?.toString().trim() ?? '';
    final caption = description.isNotEmpty ? description : title;
    final likes = (widget.video['likes'] as num?)?.toInt() ?? 0;
    final comments = (widget.video['commentCount'] as num?)?.toInt() ?? 0;
    final liked = widget.video['likedByMe'] == true;
    final bottom = widget.bottomInset;

    return GestureDetector(
      onTap: _toggleMute,
      onDoubleTap: () => _handleLike(burst: true),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (_initializing)
            const SkeletonReelPage()
          else if (_controller != null && _controller!.value.isInitialized)
            FittedBox(
              fit: BoxFit.cover,
              child: SizedBox(
                width: _controller!.value.size.width,
                height: _controller!.value.size.height,
                child: VideoPlayer(_controller!),
              ),
            )
          else
            Container(
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
              child: const Center(
                child: Icon(Icons.videocam_off_outlined, size: 48, color: AppTheme.muted),
              ),
            ),

          // Readability gradients
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
                if (widget.onMore != null) ...[
                  const SizedBox(height: 16),
                  _ActionButton(
                    icon: Icons.more_horiz_rounded,
                    label: 'More',
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
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.storefront_outlined, color: AppTheme.accent, size: 15),
                          SizedBox(width: 6),
                          Text(
                            'View courses',
                            style: TextStyle(
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
