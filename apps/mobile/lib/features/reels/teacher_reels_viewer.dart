import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/reel_video_cache.dart';
import 'package:ulearn/features/reels/reel_comments_sheet.dart';
import 'package:ulearn/features/reels/reel_page.dart';
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
  late List<Map<String, dynamic>> _videos;
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    _videos = List<Map<String, dynamic>>.from(widget.videos);
    _currentIndex = widget.initialIndex.clamp(0, _videos.length - 1);
    _pageCtrl = PageController(initialPage: _currentIndex);
    _prefetchAround(_currentIndex);
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    ReelVideoCache.disposeAll();
    super.dispose();
  }

  void _prefetchAround(int index) {
    final urls = _videos.map((v) => v['fileUrl']?.toString()).toList();
    ReelVideoCache.prefetchAround(urls, index);
    final keep = <String>{};
    for (var i = index - 1; i <= index + 2; i++) {
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
    final teacherId = widget.teacherId ?? teacher['id']?.toString();
    if (teacherId == null) return;

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => TeacherProfileScreen(
          teacherId: teacherId,
          initialName: widget.teacherName ?? teacher['name']?.toString(),
        ),
      ),
    );
  }

  void _openMoreMenu(Map<String, dynamic> video) {
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
            ListTile(
              leading: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
              title: const Text('Report content'),
              onTap: () {
                Navigator.pop(ctx);
                ReportContentSheet.show(
                  context,
                  targetType: 'SHORT_VIDEO',
                  targetId: video['id'].toString(),
                  contentTitle: video['title']?.toString() ?? 'Reel',
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom + 20;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            controller: _pageCtrl,
            scrollDirection: Axis.vertical,
            onPageChanged: (index) {
              setState(() => _currentIndex = index);
              _prefetchAround(index);
            },
            itemCount: _videos.length,
            itemBuilder: (context, index) {
              final video = _videos[index];
              return ReelPage(
                key: ValueKey(video['id']),
                video: video,
                active: index == _currentIndex,
                bottomInset: bottomInset,
                onLike: () => _toggleLike(index),
                onComment: () => _openComments(index),
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
