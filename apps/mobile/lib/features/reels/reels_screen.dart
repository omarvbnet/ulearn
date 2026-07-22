import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/reels/reel_slot.dart';
import 'package:ulearn/features/reels/reel_comments_sheet.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/reels/teacher_profile_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// Vertical short-video feed (reels) with likes and comments.
class ReelsScreen extends StatefulWidget {
  const ReelsScreen({
    super.key,
    this.isTabActive = true,
    this.refreshTrigger,
    this.initialVideoId,
    this.openCommentsOnStart = false,
    this.highlightCommentId,
  });

  final bool isTabActive;
  final ValueNotifier<int>? refreshTrigger;
  final String? initialVideoId;
  final bool openCommentsOnStart;

  /// Optional comment to focus when [openCommentsOnStart] is true.
  final String? highlightCommentId;

  @override
  State<ReelsScreen> createState() => ReelsScreenState();
}

class ReelsScreenState extends State<ReelsScreen> {
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
    widget.refreshTrigger?.addListener(_onRefreshTriggered);
    final cached = _ReelFeedMemoryCache.peek();
    if (cached != null) {
      _videos = cached.videos;
      _nextCursor = cached.nextCursor;
      _loading = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _prefetchAround(0);
      });
    }
    _load();
  }

  void _onRefreshTriggered() {
    refreshFeed();
  }

  /// Pull latest ranked reels (double-tap Reels tab).
  Future<void> refreshFeed() => _load(refresh: true);

  @override
  void didUpdateWidget(ReelsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshTrigger != widget.refreshTrigger) {
      oldWidget.refreshTrigger?.removeListener(_onRefreshTriggered);
      widget.refreshTrigger?.addListener(_onRefreshTriggered);
    }
    if (oldWidget.isTabActive != widget.isTabActive) {
      _syncPlayback();
    }
  }

  void _syncPlayback() {
    _playbackActive.value = widget.isTabActive && _routeVisible;
  }

  @override
  void dispose() {
    widget.refreshTrigger?.removeListener(_onRefreshTriggered);
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
        _loading = _videos.isEmpty;
        _nextCursor = null;
        _currentIndex = 0;
        if (_videos.isEmpty) _videos = [];
      });
      _activeIndex.value = 0;
      if (_pageCtrl.hasClients) {
        _pageCtrl.jumpToPage(0);
      }
    }
    try {
      final query = refresh ? 'limit=12&refresh=true' : 'limit=12';
      final data = await context.read<ApiClient>().get('/api/store/short-videos?$query');
      if (!mounted) return;
      final videos = ((data['videos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      setState(() {
        _videos = videos;
        _nextCursor = data['nextCursor']?.toString();
        _loading = false;
      });
      if (videos.isNotEmpty) {
        _ReelFeedMemoryCache.save(videos, _nextCursor);
      }
      var start = 0;
      final wantId = widget.initialVideoId;
      if (wantId != null && wantId.isNotEmpty) {
        final idx = videos.indexWhere((v) => v['id']?.toString() == wantId);
        if (idx >= 0) start = idx;
      }
      _activeIndex.value = start;
      _currentIndex = start;
      _prefetchAround(start);
      if (start > 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_pageCtrl.hasClients) _pageCtrl.jumpToPage(start);
          if (widget.openCommentsOnStart && mounted) {
            _openComments(start);
          }
        });
      } else if (widget.openCommentsOnStart && videos.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _openComments(0);
        });
      }
      if (refresh && mounted) {
        final l10n = context.l10n;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              videos.isEmpty
                  ? l10n.reelsNoReels
                  : l10n.t('mobile.reels.feedUpdated'),
            ),
            duration: const Duration(seconds: 2),
          ),
        );
      }
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
    for (var i = center - 1; i <= center + 1; i++) {
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
    if (!await requireAuth(context)) return;
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

  void _openComments(int index) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final video = _videos[index];
    _pauseForNavigation(() => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => ReelCommentsSheet(
            videoId: video['id'].toString(),
            videoTitle: video['title']?.toString() ?? context.l10n.reelsTitle,
            initialCount: (video['commentCount'] as num?)?.toInt() ?? 0,
            highlightCommentId: widget.highlightCommentId,
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

    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.reelsDeleteTitle),
        content: Text(l10n.reelsDeleteBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.cancel)),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            child: Text(l10n.reelsDelete),
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
          SnackBar(content: Text(context.l10n.reelsDeleted)),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.reelsDeleteFailed)),
        );
      }
    }
  }

  Future<void> _reportVideo(Map<String, dynamic> video) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final id = video['id']?.toString();
    if (id == null) return;
    await _pauseForNavigation(() => ReportContentSheet.show(
          context,
          targetType: 'SHORT_VIDEO',
          targetId: id,
          contentTitle: video['title']?.toString() ?? context.l10n.reelsTitle,
        ));
  }

  Future<void> _toggleSave(int index) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final video = _videos[index];
    final id = video['id']?.toString();
    if (id == null) return;

    final wasSaved = video['savedByMe'] == true;
    final saves = (video['saves'] as num?)?.toInt() ?? 0;
    setState(() {
      video['savedByMe'] = !wasSaved;
      video['saves'] = wasSaved ? (saves > 0 ? saves - 1 : 0) : saves + 1;
    });

    try {
      final data = await context.read<ApiClient>().post('/api/store/short-videos/$id/save', {});
      if (!mounted) return;
      setState(() {
        video['saves'] = data['saves'];
        video['savedByMe'] = data['savedByMe'];
      });
      if (mounted) {
        final l10n = context.l10n;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(data['savedByMe'] == true ? l10n.reelsSaved : l10n.reelsUnsaved),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        video['savedByMe'] = wasSaved;
        video['saves'] = saves;
      });
    }
  }

  void _openMoreMenu(Map<String, dynamic> video) {
    final isOwn = _isOwnVideo(video);
    final index = _videos.indexWhere((v) => v['id']?.toString() == video['id']?.toString());
    final saved = video['savedByMe'] == true;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (ctx) {
        final l10n = ctx.l10n;
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(
                  saved ? Icons.bookmark : Icons.bookmark_border_outlined,
                  color: AppTheme.accent,
                ),
                title: Text(saved ? l10n.reelsUnsaveReel : l10n.reelsSaveReel),
                onTap: () {
                  Navigator.pop(ctx);
                  if (index >= 0) _toggleSave(index);
                },
              ),
              if (isOwn)
                ListTile(
                  leading: const Icon(Icons.delete_outline, color: Colors.redAccent),
                  title: Text(l10n.reelsDeleteReel),
                  onTap: () {
                    Navigator.pop(ctx);
                    _deleteVideo(video);
                  },
                ),
              if (!isOwn)
                ListTile(
                  leading: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
                  title: Text(l10n.reelsReportContent),
                  onTap: () {
                    Navigator.pop(ctx);
                    _reportVideo(video);
                  },
                ),
              ListTile(
                leading: const Icon(Icons.person_outline, color: AppTheme.accent),
                title: Text(l10n.reelsViewTeacher),
                onTap: () {
                  Navigator.pop(ctx);
                  _openTeacherProfile(video);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SkeletonReelFeed();
    }

    if (_videos.isEmpty) {
      final l10n = context.l10n;
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
                  Text(
                    l10n.reelsNoReels,
                    style: TextStyle(color: AppTheme.foreground, fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.profileTeacherStudioHint,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85), height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  TextButton.icon(
                    onPressed: () => _load(refresh: true),
                    icon: const Icon(Icons.refresh, color: AppTheme.accent),
                    label: Text(l10n.reelsRefresh, style: const TextStyle(color: AppTheme.accent)),
                  ),
                ],
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    const ULearnLogo(size: 28),
                    const SizedBox(width: 8),
                    Text(
                      l10n.reelsTitle,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
                    ),
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
            // Prebuild the adjacent page so swipe-in can attach faster.
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
                onSave: () {
                  final i = _videos.indexWhere(
                    (v) => v['id']?.toString() == video['id']?.toString(),
                  );
                  if (i >= 0) _toggleSave(i);
                },
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
                    child: Text(
                      context.l10n.reelsTitle,
                      style: const TextStyle(
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
                                appBar: GlassAppBar(title: Text(context.l10n.navNotifications)),
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

/// In-memory feed so returning to Reels skips the full-screen skeleton.
/// Expires so signed R2 URLs (≈6h) are not reused after they go stale.
class _ReelFeedMemoryCache {
  static List<Map<String, dynamic>>? _videos;
  static String? _nextCursor;
  static DateTime? _savedAt;
  static const _ttl = Duration(minutes: 45);

  static void save(List<Map<String, dynamic>> videos, String? nextCursor) {
    _videos = List<Map<String, dynamic>>.from(videos);
    _nextCursor = nextCursor;
    _savedAt = DateTime.now();
  }

  static ({List<Map<String, dynamic>> videos, String? nextCursor})? peek() {
    if (_videos == null || _videos!.isEmpty || _savedAt == null) return null;
    if (DateTime.now().difference(_savedAt!) > _ttl) {
      _videos = null;
      _nextCursor = null;
      _savedAt = null;
      return null;
    }
    return (
      videos: List<Map<String, dynamic>>.from(_videos!),
      nextCursor: _nextCursor,
    );
  }
}
