import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';
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
  });

  final Map<String, dynamic> video;
  final bool active;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback? onTeacherTap;

  @override
  State<ReelPage> createState() => _ReelPageState();
}

class _ReelPageState extends State<ReelPage> with SingleTickerProviderStateMixin {
  VideoPlayerController? _controller;
  bool _initializing = true;
  bool _muted = false;
  late final AnimationController _likePulse;

  @override
  void initState() {
    super.initState();
    _likePulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 320),
      lowerBound: 0.85,
      upperBound: 1.25,
    );
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
  }

  Future<void> _initVideo() async {
    final url = widget.video['fileUrl']?.toString();
    if (url == null || url.isEmpty) {
      if (mounted) setState(() => _initializing = false);
      return;
    }
    try {
      final c = VideoPlayerController.networkUrl(Uri.parse(url));
      await c.initialize();
      c.setLooping(true);
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
    _controller?.dispose();
    super.dispose();
  }

  void _togglePlay() {
    final c = _controller;
    if (c == null) return;
    if (c.value.isPlaying) {
      c.pause();
    } else {
      c.play();
    }
    setState(() {});
  }

  void _handleLike() {
    _likePulse.forward(from: 0).then((_) => _likePulse.reverse());
    widget.onLike();
  }

  String _formatCount(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  @override
  Widget build(BuildContext context) {
    final teacher = widget.video['teacher'] as Map<String, dynamic>? ?? {};
    final name = teacher['name']?.toString() ?? 'Teacher';
    final level = teacher['level']?.toString() ?? '';
    final teacherPhoto = teacher['profilePhotoUrl']?.toString();
    final title = widget.video['title']?.toString() ?? '';
    final likes = (widget.video['likes'] as num?)?.toInt() ?? 0;
    final comments = (widget.video['commentCount'] as num?)?.toInt() ?? 0;
    final liked = widget.video['likedByMe'] == true;

    return GestureDetector(
      onTap: _togglePlay,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (_initializing)
            const Center(child: CircularProgressIndicator(color: AppTheme.accent))
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

          // Cinematic vignette
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.black.withValues(alpha: 0.55),
                  Colors.transparent,
                  Colors.transparent,
                  Colors.black.withValues(alpha: 0.75),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: const [0, 0.2, 0.65, 1],
              ),
            ),
          ),

          // Play/pause hint
          if (_controller != null && !_controller!.value.isPlaying)
            Center(
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.black45,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white24),
                ),
                child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 42),
              ),
            ),

          // Right action rail
          Positioned(
            right: 12,
            bottom: 120,
            child: Column(
              children: [
                GestureDetector(
                  onTap: widget.onTeacherTap,
                  child: ProfileAvatar(
                    name: name,
                    photoUrl: teacherPhoto,
                    size: 48,
                  ),
                ),
                const SizedBox(height: 22),
                ScaleTransition(
                  scale: _likePulse,
                  child: _ActionButton(
                    icon: liked ? Icons.favorite : Icons.favorite_border,
                    label: _formatCount(likes),
                    color: liked ? Colors.redAccent : Colors.white,
                    onTap: _handleLike,
                  ),
                ),
                const SizedBox(height: 18),
                _ActionButton(
                  icon: Icons.mode_comment_outlined,
                  label: _formatCount(comments),
                  onTap: widget.onComment,
                ),
                const SizedBox(height: 18),
                _ActionButton(
                  icon: _muted ? Icons.volume_off_rounded : Icons.volume_up_rounded,
                  label: _muted ? 'Off' : 'Sound',
                  onTap: () {
                    setState(() => _muted = !_muted);
                    _controller?.setVolume(_muted ? 0 : 1);
                  },
                ),
              ],
            ),
          ),

          // Bottom info
          Positioned(
            left: 16,
            right: 72,
            bottom: 28,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    GestureDetector(
                      onTap: widget.onTeacherTap,
                      behavior: HitTestBehavior.opaque,
                      child: Text(
                        name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    if (level.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppTheme.primary.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          level.replaceAll('_', ' '),
                          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (widget.onTeacherTap != null) ...[
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: widget.onTeacherTap,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: Colors.white24),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.storefront_outlined, color: AppTheme.accent, size: 14),
                          SizedBox(width: 6),
                          Text(
                            'View live courses',
                            style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
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
              color: Colors.black.withValues(alpha: 0.35),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white12),
            ),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
