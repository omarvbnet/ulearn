import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/reels/reel_slot.dart';
import 'package:ulearn/features/reels/reel_comments_sheet.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/reels/teacher_profile_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';

/// Vertical short-video feed (reels) with likes and comments.
class ReelsScreen extends StatefulWidget {
  const ReelsScreen({super.key, this.isTabActive = true});

  final bool isTabActive;

  @override
  State<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends State<ReelsScreen> {
  final _pageCtrl = PageController();
  final _activeIndex = ValueNotifier(0);
  final _playbackActive = ValueNotifier(true);
  List<Map<String, dynamic>> _videos = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _nextCursor;
  int _currentIndex = 0;
  bool _routeVisible = true;

  static const _bottomInset = 116.0;

  @override
  void initState() {
    super.initState();
    _syncPlayback();
    _load();
  }

  void _syncPlayback() {
    _playbackActive.value = widget.isTabActive && _routeVisible;
  }

  @override
  void didUpdateWidget(ReelsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isTabActive != widget.isTabActive) {
      _syncPlayback();
    }
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    _activeIndex.dispose();
    _playbackActive.dispose();
    ReelVideoCache.releaseWarm();
    super.dispose();
  }

  Future<T?> _pauseForNavigation<T>(Future<T?> Function() action) async {
    _routeVisible = false;
    _syncPlayback();
    try {
      return await action();
    } finally {
      if (mounted) {
        _routeVisible = true;
        _syncPlayback();
      }
    }
  }

  Future<void> _load({bool refresh = false}) async {
    if (refresh) {
      setState(() {
        _loading = true;
        _videos = [];
        _nextCursor = null;
        _currentIndex = 0;
      });
      _activeIndex.value = 0;
      if (_pageCtrl.hasClients) {
        _pageCtrl.jumpToPage(0);
      }
    }
    try {
      final data = await context.read<ApiClient>().get('/api/store/short-videos?limit=12');
      if (!mounted) return;
      final videos = ((data['videos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      setState(() {
        _videos = videos;
        _nextCursor = data['nextCursor']?.toString();
        _loading = false;
      });
      _activeIndex.value = 0;
      _prefetchAround(0);
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _prefetchAround(int index) {
    final urls = _videos.map((v) => v['fileUrl']?.toString()).toList();
    ReelVideoCache.prefetchAround(urls, index);
    _trimWarmControllers(index);
  }

  void _trimWarmControllers(int center) {
    final keep = <String>{};
    for (var i = center - 1; i <= center + 2; i++) {
      if (i < 0 || i >= _videos.length) continue;
      final url = _videos[i]['fileUrl']?.toString();
      if (url != null && url.isNotEmpty) keep.add(url);
    }
    ReelVideoCache.trimWarm(keep);
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
    _currentIndex = index;
    _activeIndex.value = index;
    _prefetchAround(index);
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
    _pauseForNavigation(() => showModalBottomSheet<void>(
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
        ));
  }

  void _openTeacherProfile(Map<String, dynamic> video) {
    final teacher = video['teacher'] as Map<String, dynamic>? ?? {};
    final teacherId = teacher['id']?.toString();
    if (teacherId == null) return;

    _pauseForNavigation(() => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => TeacherProfileScreen(
              teacherId: teacherId,
              initialName: teacher['name']?.toString(),
            ),
          ),
        ));
  }

  bool _isOwnVideo(Map<String, dynamic> video) {
    final teacher = video['teacher'] as Map<String, dynamic>? ?? {};
    final teacherUserId = teacher['userId']?.toString();
    final currentUserId = context.read<AuthProvider>().user?.id;
    return teacherUserId != null &&
        currentUserId != null &&
        teacherUserId == currentUserId;
  }

  Future<void> _deleteVideo(Map<String, dynamic> video) async {
    final id = video['id']?.toString();
    if (id == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete reel?'),
        content: const Text('This video will be removed from the feed permanently.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await context.read<ApiClient>().delete('/api/teacher/short-videos/$id');
      if (!mounted) return;
      final index = _videos.indexWhere((v) => v['id']?.toString() == id);
      setState(() {
        _videos.removeWhere((v) => v['id']?.toString() == id);
        if (_videos.isEmpty) {
          _currentIndex = 0;
        } else if (_currentIndex >= _videos.length) {
          _currentIndex = _videos.length - 1;
        } else if (index >= 0 && index <= _currentIndex && _currentIndex > 0) {
          _currentIndex -= 1;
        }
      });
      _activeIndex.value = _videos.isEmpty ? 0 : _currentIndex;
      if (_videos.isNotEmpty && _pageCtrl.hasClients) {
        final target = _currentIndex.clamp(0, _videos.length - 1);
        if (_pageCtrl.page?.round() != target) {
          _pageCtrl.jumpToPage(target);
        }
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reel deleted')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not delete reel')),
        );
      }
    }
  }

  Future<void> _reportVideo(Map<String, dynamic> video) async {
    final id = video['id']?.toString();
    if (id == null) return;
    await _pauseForNavigation(() => ReportContentSheet.show(
          context,
          targetType: 'SHORT_VIDEO',
          targetId: id,
          contentTitle: video['title']?.toString() ?? 'Reel',
        ));
  }

  void _openMoreMenu(Map<String, dynamic> video) {
    final isOwn = _isOwnVideo(video);
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isOwn)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.redAccent),
                title: const Text('Delete reel'),
                onTap: () {
                  Navigator.pop(ctx);
                  _deleteVideo(video);
                },
              ),
            if (!isOwn)
              ListTile(
                leading: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
                title: const Text('Report content'),
                onTap: () {
                  Navigator.pop(ctx);
                  _reportVideo(video);
                },
              ),
            ListTile(
              leading: const Icon(Icons.person_outline, color: AppTheme.accent),
              title: const Text('View teacher profile'),
              onTap: () {
                Navigator.pop(ctx);
                _openTeacherProfile(video);
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SkeletonReelFeed();
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
                    Text('Reels', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
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
            physics: const PageScrollPhysics(parent: ClampingScrollPhysics()),
            allowImplicitScrolling: true,
            onPageChanged: _onPageChanged,
            itemCount: _videos.length,
            itemBuilder: (context, index) {
              final video = _videos[index];
              return ReelSlot(
                key: ValueKey(video['id']),
                index: index,
                activeIndex: _activeIndex,
                playbackActive: _playbackActive,
                video: video,
                bottomInset: _bottomInset,
                onLike: () => _toggleLike(index),
                onComment: () => _openComments(index),
                onTeacherTap: () => _openTeacherProfile(video),
                onMore: () => _openMoreMenu(video),
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
                      onPressed: () => _pauseForNavigation(() => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => Scaffold(
                                appBar: AppBar(title: const Text('Notifications')),
                                body: const NotificationsScreen(),
                              ),
                            ),
                          )),
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
