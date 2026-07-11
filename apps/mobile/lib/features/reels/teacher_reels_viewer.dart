import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/features/reels/reel_comments_sheet.dart';
import 'package:ulearn/features/reels/reel_slot.dart';
import 'package:ulearn/features/reels/teacher_profile_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';

/// Full-screen viewer for a teacher's short videos (from profile grid).
class TeacherReelsViewer extends StatefulWidget {
  const TeacherReelsViewer({
    super.key,
    required this.videos,
    required this.initialIndex,
    this.teacherId,
    this.teacherName,
  });

  final List<Map<String, dynamic>> videos;
  final int initialIndex;
  final String? teacherId;
  final String? teacherName;

  @override
  State<TeacherReelsViewer> createState() => _TeacherReelsViewerState();
}

class _TeacherReelsViewerState extends State<TeacherReelsViewer> {
  late final PageController _pageCtrl;
  late final ValueNotifier<int> _activeIndex;
  late final ValueNotifier<bool> _playbackActive;
  late List<Map<String, dynamic>> _videos;
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    _videos = List<Map<String, dynamic>>.from(widget.videos);
    _currentIndex = _videos.isEmpty ? 0 : widget.initialIndex.clamp(0, _videos.length - 1);
    _activeIndex = ValueNotifier(_currentIndex);
    _playbackActive = ValueNotifier(true);
    _pageCtrl = PageController(initialPage: _currentIndex);
    if (_videos.isNotEmpty) _prefetchAround(_currentIndex);
  }

  @override
  void dispose() {
    _playbackActive.value = false;
    _pageCtrl.dispose();
    _activeIndex.dispose();
    _playbackActive.dispose();
    ReelVideoCache.releaseWarm();
    super.dispose();
  }

  void _prefetchAround(int index) {
    final urls = _videos.map((v) => v['fileUrl']?.toString()).toList();
    ReelVideoCache.prefetchAround(urls, index);
    final keep = <String>{};
    for (var i = index - 1; i <= index + 1; i++) {
      if (i < 0 || i >= _videos.length) continue;
      final url = _videos[i]['fileUrl']?.toString();
      if (url != null && url.isNotEmpty) keep.add(url);
    }
    ReelVideoCache.trimWarm(keep);
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
    _playbackActive.value = false;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ReelCommentsSheet(
        videoId: video['id'].toString(),
        videoTitle: video['title']?.toString() ?? context.l10n.reelsTitle,
        initialCount: (video['commentCount'] as num?)?.toInt() ?? 0,
        onCountChanged: (count) {
          if (mounted) setState(() => video['commentCount'] = count);
        },
      ),
    ).whenComplete(() {
      if (mounted) _playbackActive.value = true;
    });
  }

  void _openTeacherProfile(Map<String, dynamic> video) {
    final teacher = video['teacher'] as Map<String, dynamic>? ?? {};
    final teacherId = widget.teacherId ?? teacher['id']?.toString();
    if (teacherId == null) return;

    _playbackActive.value = false;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => TeacherProfileScreen(
          teacherId: teacherId,
          initialName: widget.teacherName ?? teacher['name']?.toString(),
        ),
      ),
    );
  }

  Future<void> _toggleSave(int index) async {
    if (index < 0) return;
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
    } catch (_) {
      if (!mounted) return;
      setState(() {
        video['savedByMe'] = wasSaved;
        video['saves'] = saves;
      });
    }
  }

  void _openMoreMenu(Map<String, dynamic> video) {
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
                  _toggleSave(_videos.indexOf(video));
                },
              ),
              ListTile(
                leading: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
                title: Text(l10n.reelsReportContent),
                onTap: () {
                  Navigator.pop(ctx);
                  ReportContentSheet.show(
                    context,
                    targetType: 'SHORT_VIDEO',
                    targetId: video['id'].toString(),
                    contentTitle: video['title']?.toString() ?? l10n.reelsTitle,
                  );
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
    if (_videos.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.transparent),
        body: Center(
          child: Text(
            context.l10n.reelsNoReels,
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      );
    }

    final bottomInset = MediaQuery.paddingOf(context).bottom + 20;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            controller: _pageCtrl,
            scrollDirection: Axis.vertical,
            physics: const PageScrollPhysics(parent: ClampingScrollPhysics()),
            allowImplicitScrolling: false,
            onPageChanged: (index) {
              _currentIndex = index;
              _activeIndex.value = index;
              _prefetchAround(index);
            },
            itemCount: _videos.length,
            itemBuilder: (context, index) {
              final video = _videos[index];
              return ReelSlot(
                key: ValueKey(video['id']),
                index: index,
                activeIndex: _activeIndex,
                playbackActive: _playbackActive,
                video: video,
                bottomInset: bottomInset,
                onLike: () => _toggleLike(index),
                onComment: () => _openComments(index),
                onSave: () {
                  final i = _videos.indexWhere(
                    (v) => v['id']?.toString() == video['id']?.toString(),
                  );
                  if (i >= 0) _toggleSave(i);
                },
                onTeacherTap: widget.teacherId != null ? () => _openTeacherProfile(video) : null,
                onMore: () => _openMoreMenu(video),
              );
            },
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
