import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// The student's bookmarked courses and videos, in two tabs.
class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  List<Map<String, dynamic>>? _courses;
  List<Map<String, dynamic>>? _lessons;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/profile/favorites');
      if (!mounted) return;
      setState(() {
        _courses =
            ((data['courses'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _lessons =
            ((data['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _courses = [];
        _lessons = [];
      });
    }
  }

  Future<void> _unfavoriteCourse(Map<String, dynamic> course) async {
    setState(() => _courses?.remove(course));
    try {
      await context
          .read<ApiClient>()
          .post('/api/store/courses/${course['id']}/favorite', {});
    } catch (_) {
      if (mounted) _load();
    }
  }

  Future<void> _unfavoriteLesson(Map<String, dynamic> lesson) async {
    setState(() => _lessons?.remove(lesson));
    try {
      await context
          .read<ApiClient>()
          .post('/api/store/lessons/${lesson['id']}/favorite', {});
    } catch (_) {
      if (mounted) _load();
    }
  }

  Future<void> _toggleLessonLike(Map<String, dynamic> lesson) async {
    final wasLiked = lesson['likedByMe'] == true;
    setState(() {
      lesson['likedByMe'] = !wasLiked;
      lesson['likes'] = ((lesson['likes'] as num?)?.toInt() ?? 0) + (wasLiked ? -1 : 1);
    });
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/lessons/${lesson['id']}/like', {});
      if (!mounted) return;
      setState(() {
        lesson['likes'] = data['likes'];
        lesson['likedByMe'] = data['likedByMe'];
      });
    } catch (_) {}
  }

  Future<void> _openCourse(String courseId, {Map<String, dynamic>? summary}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CourseDetailScreen(courseId: courseId, summary: summary),
      ),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.localeCode;
    final l10n = context.l10n;

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: GlassAppBar(
          title: Text(l10n.profileFavorites),
          bottom: TabBar(
            indicatorColor: AppTheme.accent,
            labelColor: AppTheme.accent,
            unselectedLabelColor: AppTheme.muted,
            tabs: [
              Tab(
                  text:
                      '${l10n.favoritesCoursesTab}${_courses != null ? ' (${_courses!.length})' : ''}'),
              Tab(
                  text:
                      '${l10n.favoritesVideosTab}${_lessons != null ? ' (${_lessons!.length})' : ''}'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _buildCoursesTab(locale),
            _buildVideosTab(locale),
          ],
        ),
      ),
    );
  }

  Widget _buildCoursesTab(String locale) {
    final courses = _courses;
    if (courses == null) {
      return SkeletonList(
        count: 3,
        itemBuilder: (_) => const SkeletonCourseCard(),
      );
    }
    if (courses.isEmpty) {
      return _EmptyFavorites(
        icon: Icons.favorite_border,
        message: context.l10n.favoritesEmptyCourses,
      );
    }
    return RefreshIndicator(
      color: AppTheme.accent,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 16, bottom: 24),
        children: courses
            .asMap()
            .entries
            .map(
              (e) => StaggeredItem(
                index: e.key,
                child: CourseCard(
                  course: e.value,
                  locale: locale,
                  onTap: () =>
                      _openCourse(e.value['id'].toString(), summary: e.value),
                  onReact: (_) {},
                  onFavorite: () => _unfavoriteCourse(e.value),
                ),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _buildVideosTab(String locale) {
    final lessons = _lessons;
    if (lessons == null) {
      return SkeletonList(
        count: 7,
        itemBuilder: (_) => const SkeletonListTile(),
      );
    }
    if (lessons.isEmpty) {
      return _EmptyFavorites(
        icon: Icons.video_library_outlined,
        message: context.l10n.favoritesEmptyVideos,
      );
    }
    return RefreshIndicator(
      color: AppTheme.accent,
      onRefresh: _load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: lessons.length,
        itemBuilder: (context, i) {
          final lesson = lessons[i];
          final course = lesson['course'] as Map<String, dynamic>? ?? {};
          final thumbnail = course['thumbnail']?.toString();
          final teacherName = ((course['teacher'] as Map<String, dynamic>?)?['user']
                  as Map<String, dynamic>?)?['fullLegalName']
              ?.toString();

          return StaggeredItem(
            index: i,
            child: Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppTheme.cardBorder),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => _openCourse(course['id']?.toString() ?? ''),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: SizedBox(
                          width: 84,
                          height: 56,
                          child: thumbnail != null && thumbnail.isNotEmpty
                              ? CachedImage(
                                  url: thumbnail,
                                  fit: BoxFit.cover,
                                  error: const _VideoThumbFallback(),
                                )
                              : const _VideoThumbFallback(),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              lesson['title']?.toString() ?? context.l10n.t('student.videos'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600, fontSize: 14),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              [
                                localizedText(course, locale),
                                ?teacherName,
                              ].join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  color: AppTheme.muted, fontSize: 12),
                            ),
                            const SizedBox(height: 5),
                            Row(
                              children: [
                                if (lesson['durationSec'] != null) ...[
                                  Icon(Icons.schedule,
                                      size: 12, color: AppTheme.muted),
                                  const SizedBox(width: 3),
                                  Text(
                                    formatDuration(
                                        (lesson['durationSec'] as num).toInt()),
                                    style: TextStyle(
                                        color: AppTheme.muted, fontSize: 11.5),
                                  ),
                                  const SizedBox(width: 12),
                                ],
                                if (lesson['isFreePreview'] == true)
                                  Text(
                                    context.l10n.t('mobile.favorites.freePreview'),
                                    style: const TextStyle(
                                      color: Colors.greenAccent,
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ReactionButton(
                            icon: Icons.thumb_up_outlined,
                            activeIcon: Icons.thumb_up,
                            active: lesson['likedByMe'] == true,
                            activeColor: AppTheme.accent,
                            count: (lesson['likes'] as num?)?.toInt() ?? 0,
                            onTap: () => _toggleLessonLike(lesson),
                          ),
                          const SizedBox(height: 10),
                          GestureDetector(
                            onTap: () => _unfavoriteLesson(lesson),
                            behavior: HitTestBehavior.opaque,
                            child: const Icon(
                              Icons.favorite,
                              size: 18,
                              color: Colors.redAccent,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _EmptyFavorites extends StatelessWidget {
  const _EmptyFavorites({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleIn(
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppTheme.primary.withValues(alpha: 0.12),
                ),
                child: Icon(icon, size: 34, color: AppTheme.accent),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.muted, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoThumbFallback extends StatelessWidget {
  const _VideoThumbFallback();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.35),
            AppTheme.accent.withValues(alpha: 0.2),
          ],
        ),
      ),
      child: const Icon(Icons.play_circle_outline, color: Colors.white70, size: 24),
    );
  }
}
