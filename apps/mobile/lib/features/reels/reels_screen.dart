import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/reels/reel_page.dart';
import 'package:ulearn/features/reels/reel_comments_sheet.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/reels/teacher_profile_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';

/// Vertical short-video feed (reels) with likes and comments.
class ReelsScreen extends StatefulWidget {
  const ReelsScreen({super.key});

  @override
  State<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends State<ReelsScreen> {
  final _pageCtrl = PageController();
  List<Map<String, dynamic>> _videos = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _nextCursor;
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    super.dispose();
  }

  Future<void> _load({bool refresh = false}) async {
    if (refresh) {
      setState(() {
        _loading = true;
        _videos = [];
        _nextCursor = null;
        _currentIndex = 0;
      });
    }
    try {
      final data = await context.read<ApiClient>().get('/api/store/short-videos?limit=12');
      if (!mounted) return;
      setState(() {
        _videos = ((data['videos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _nextCursor = data['nextCursor']?.toString();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _nextCursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final data = await context
          .read<ApiClient>()
          .get('/api/store/short-videos?limit=12&cursor=$_nextCursor');
      if (!mounted) return;
      setState(() {
        _videos.addAll(((data['videos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>());
        _nextCursor = data['nextCursor']?.toString();
        _loadingMore = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _onPageChanged(int index) {
    setState(() => _currentIndex = index);
    if (index >= _videos.length - 3) _loadMore();
  }

  Future<void> _toggleLike(int index) async {
    final video = _videos[index];
    final id = video['id']?.toString();
    if (id == null) return;

    final wasLiked = video['likedByMe'] == true;
    final likes = (video['likes'] as num?)?.toInt() ?? 0;
    setState(() {
      video['likedByMe'] = !wasLiked;
      video['likes'] = wasLiked ? (likes > 0 ? likes - 1 : 0) : likes + 1;
    });

    try {
      final data = await context.read<ApiClient>().post('/api/store/short-videos/$id/like', {});
      if (!mounted) return;
      setState(() {
        video['likes'] = data['likes'];
        video['likedByMe'] = data['likedByMe'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        video['likedByMe'] = wasLiked;
        video['likes'] = likes;
      });
    }
  }

  void _openComments(int index) {
    final video = _videos[index];
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ReelCommentsSheet(
        videoId: video['id'].toString(),
        videoTitle: video['title']?.toString() ?? 'Reel',
        initialCount: (video['commentCount'] as num?)?.toInt() ?? 0,
        onCountChanged: (count) {
          if (mounted) setState(() => video['commentCount'] = count);
        },
      ),
    );
  }

  void _openTeacherProfile(Map<String, dynamic> video) {
    final teacher = video['teacher'] as Map<String, dynamic>? ?? {};
    final teacherId = teacher['id']?.toString();
    if (teacherId == null) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TeacherProfileScreen(
          teacherId: teacherId,
          initialName: teacher['name']?.toString(),
        ),
      ),
    );
  }

  Future<void> _reportVideo(Map<String, dynamic> video) async {
    final id = video['id']?.toString();
    if (id == null) return;
    await ReportContentSheet.show(
      context,
      targetType: 'SHORT_VIDEO',
      targetId: id,
      contentTitle: video['title']?.toString() ?? 'Reel',
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const ColoredBox(
        color: Colors.black,
        child: Center(child: SkeletonBox(width: 120, height: 120, radius: 16)),
      );
    }

    if (_videos.isEmpty) {
      return ColoredBox(
        color: Colors.black,
        child: Stack(
          children: [
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.movie_filter_outlined, size: 56, color: AppTheme.muted.withValues(alpha: 0.5)),
                  const SizedBox(height: 16),
                  const Text(
                    'No reels yet',
                    style: TextStyle(color: AppTheme.foreground, fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Teachers can upload short videos\nfrom Teacher Studio',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85), height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  TextButton.icon(
                    onPressed: () => _load(refresh: true),
                    icon: const Icon(Icons.refresh, color: AppTheme.accent),
                    label: const Text('Refresh', style: TextStyle(color: AppTheme.accent)),
                  ),
                ],
              ),
            ),
            const SafeArea(
              child: Padding(
                padding: EdgeInsets.all(12),
                child: Row(
                  children: [
                    ULearnLogo(size: 28),
                    SizedBox(width: 8),
                    Text('Reels', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    return ColoredBox(
      color: Colors.black,
      child: Stack(
        children: [
          PageView.builder(
            controller: _pageCtrl,
            scrollDirection: Axis.vertical,
            onPageChanged: _onPageChanged,
            itemCount: _videos.length,
            itemBuilder: (context, index) {
              final video = _videos[index];
              return ReelPage(
                key: ValueKey(video['id']),
                video: video,
                active: index == _currentIndex,
                onLike: () => _toggleLike(index),
                onComment: () => _openComments(index),
                onTeacherTap: () => _openTeacherProfile(video),
                onReport: () => _reportVideo(video),
              );
            },
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
              child: Row(
                children: [
                  const ULearnLogo(size: 26),
                  const SizedBox(width: 8),
                  ShaderMask(
                    shaderCallback: (bounds) => AppTheme.gradient.createShader(bounds),
                    child: const Text(
                      'Reels',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (_loadingMore)
                    const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
                    )
                  else
                    IconButton(
                      icon: const Icon(Icons.notifications_outlined, color: Colors.white),
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => Scaffold(
                            appBar: AppBar(title: const Text('Notifications')),
                            body: const NotificationsScreen(),
                          ),
                        ),
                      ),
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
