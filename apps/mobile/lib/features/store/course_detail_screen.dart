import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/lesson_cover.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_inline_player.dart';
import 'package:ulearn/features/store/lesson_qa_section.dart';
import 'package:ulearn/features/quiz/quiz_screen.dart';

/// Store course detail with inline free-video playback, smart lesson covers,
/// fullscreen casting watermark, and per-video Q&A.
class CourseDetailScreen extends StatefulWidget {
  const CourseDetailScreen({
    super.key,
    required this.courseId,
    this.summary,
  });

  final String courseId;
  final Map<String, dynamic>? summary;

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> {
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _activeLesson;
  bool _purchased = false;
  bool _buying = false;
  bool _favorited = false;
  List<Map<String, dynamic>> _quizzes = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _course = widget.summary != null ? Map.of(widget.summary!) : null;
    _load();
    _countView();
  }

  bool _canWatch(Map<String, dynamic> lesson, bool unlocked) {
    if (lesson['canWatch'] == true && lesson['fileUrl'] != null) return true;
    final isPreview = lesson['isFreePreview'] == true;
    return (unlocked || isPreview) && lesson['fileUrl'] != null;
  }

  void _selectInitialLesson(List<Map<String, dynamic>> lessons, bool unlocked) {
    for (final l in lessons) {
      if (_canWatch(l, unlocked)) {
        _activeLesson = l;
        return;
      }
    }
  }

  Future<void> _countView() async {
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/view', {});
      if (!mounted) return;
      setState(() => _course?['viewCount'] = data['viewCount']);
    } catch (_) {}
  }

  Future<void> _load() async {
    try {
      final data =
          await context.read<ApiClient>().get('/api/store/courses/${widget.courseId}');
      if (!mounted) return;
      final course = data['course'] as Map<String, dynamic>;
      final purchased = data['purchased'] == true;
      final price = (course['price'] as num?)?.toDouble() ?? 0;
      final unlocked = purchased || course['purchaseStatus'] == 'PAID' || price <= 0;
      final lessons =
          ((course['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      final quizzes =
          ((data['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

      setState(() {
        _course = {...?_course, ...course};
        _purchased = purchased;
        _favorited = data['favoritedByMe'] == true;
        _quizzes = quizzes;
        _error = null;
        _selectInitialLesson(lessons, unlocked);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load the course');
    }
  }

  Future<void> _react(String type) async {
    final course = _course;
    if (course == null) return;
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/react', {'type': type});
      if (!mounted) return;
      setState(() {
        course['likes'] = data['likes'];
        course['dislikes'] = data['dislikes'];
        course['myReaction'] = data['myReaction'];
      });
    } catch (_) {}
  }

  Future<void> _toggleFavorite() async {
    final was = _favorited;
    setState(() => _favorited = !was);
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/favorite', {});
      if (!mounted) return;
      setState(() {
        _favorited = data['favoritedByMe'] == true;
        _course?['favoritedByMe'] = _favorited;
        _course?['favorites'] = data['favorites'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _favorited = was);
    }
  }

  Future<void> _toggleLessonLike(Map<String, dynamic> lesson) async {
    final id = lesson['id'].toString();
    final wasLiked = lesson['likedByMe'] == true;
    setState(() {
      lesson['likedByMe'] = !wasLiked;
      lesson['likes'] = ((lesson['likes'] as num?)?.toInt() ?? 0) + (wasLiked ? -1 : 1);
    });
    try {
      final data =
          await context.read<ApiClient>().post('/api/store/lessons/$id/like', {});
      if (!mounted) return;
      setState(() {
        lesson['likes'] = data['likes'];
        lesson['likedByMe'] = data['likedByMe'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        lesson['likedByMe'] = wasLiked;
        lesson['likes'] = ((lesson['likes'] as num?)?.toInt() ?? 0) + (wasLiked ? 1 : -1);
      });
    }
  }

  Future<void> _toggleLessonFavorite(Map<String, dynamic> lesson) async {
    final id = lesson['id'].toString();
    final was = lesson['favoritedByMe'] == true;
    setState(() => lesson['favoritedByMe'] = !was);
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/lessons/$id/favorite', {});
      if (!mounted) return;
      setState(() => lesson['favoritedByMe'] = data['favoritedByMe'] == true);
    } catch (_) {
      if (!mounted) return;
      setState(() => lesson['favoritedByMe'] = was);
    }
  }

  Future<void> _buy() async {
    setState(() => _buying = true);
    try {
      await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/purchase', {});
      if (!mounted) return;
      setState(() => _course?['purchaseStatus'] = 'PENDING');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Subscription requested — we\'ll confirm your payment shortly'),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? 'You already requested this course'
                : 'Failed to request the subscription',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  void _selectLesson(Map<String, dynamic> lesson, bool unlocked) {
    if (!_canWatch(lesson, unlocked)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Subscribe to unlock this video')),
      );
      return;
    }
    setState(() => _activeLesson = lesson);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final locale = auth.user?.locale ?? 'AR';
    final course = _course;

    if (course == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error != null
            ? Center(child: Text(_error!, style: const TextStyle(color: AppTheme.muted)))
            : Skeleton(
                child: ListView(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: EdgeInsets.zero,
                  children: const [
                    SkeletonBox(height: 210, radius: 0),
                    Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonLine(width: 220, height: 16),
                          SizedBox(height: 12),
                          SkeletonBox(height: 72, radius: 12),
                          SizedBox(height: 20),
                          SkeletonBox(height: 56, radius: 12),
                          SkeletonBox(height: 56, radius: 12),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
      );
    }

    final title = localizedText(course, locale);
    final teacher = course['teacher'] as Map<String, dynamic>?;
    final teacherName =
        (teacher?['user'] as Map<String, dynamic>?)?['fullLegalName']?.toString() ??
            'Teacher';
    final rating = (course['teacherRating'] as num?)?.toDouble() ?? 0;
    final views = (course['viewCount'] as num?)?.toInt() ?? 0;
    final likes = (course['likes'] as num?)?.toInt() ?? 0;
    final dislikes = (course['dislikes'] as num?)?.toInt() ?? 0;
    final myReaction = course['myReaction']?.toString();
    final price = (course['price'] as num?)?.toDouble() ?? 0;
    final currency = course['currency']?.toString() ?? 'IQD';
    final isFree = price <= 0;
    final purchaseStatus = course['purchaseStatus']?.toString();
    final description = course['description']?.toString();
    final lessons =
        ((course['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    final totalSec = lessons.fold<int>(
      0,
      (s, l) => s + ((l['durationSec'] as num?)?.toInt() ?? 0),
    );
    final unlocked = _purchased || purchaseStatus == 'PAID' || isFree;
    final active = _activeLesson;
    final activeUrl = active?['fileUrl']?.toString();
    final activeId = active?['id']?.toString();

    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FavoriteButton(
              active: _favorited,
              onTap: _toggleFavorite,
              size: 36,
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 120),
        children: [
          if (activeUrl != null && activeUrl.isNotEmpty) ...[
            CourseInlinePlayer(
              key: ValueKey(activeUrl),
              url: ApiClient.absoluteUrl(activeUrl),
              title: active?['title']?.toString() ?? 'Lesson',
              lessonId: activeId,
            ),
            const SizedBox(height: 8),
            Text(
              active?['title']?.toString() ?? '',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
          ] else if (!unlocked) ...[
            Container(
              height: 180,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: AppTheme.gradient,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.lock_outline, color: Colors.white70, size: 40),
                  SizedBox(height: 8),
                  Text(
                    'Subscribe to watch videos',
                    style: TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          StaggeredItem(
            index: 0,
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: AppTheme.gradient,
                  ),
                  child: Center(
                    child: Text(
                      teacherName.isNotEmpty ? teacherName[0].toUpperCase() : '?',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(teacherName, style: const TextStyle(fontWeight: FontWeight.w600)),
                      Row(
                        children: [
                          const Icon(Icons.star_rounded, size: 15, color: Colors.amber),
                          const SizedBox(width: 3),
                          Text(
                            rating > 0 ? rating.toStringAsFixed(1) : 'No ratings yet',
                            style: const TextStyle(fontSize: 12.5, color: AppTheme.muted),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            '${formatCount(views)} views · ${formatDuration(totalSec)}',
                            style: const TextStyle(fontSize: 12.5, color: AppTheme.muted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          StaggeredItem(
            index: 1,
            child: Row(
              children: [
                ReactionButton(
                  icon: Icons.thumb_up_outlined,
                  activeIcon: Icons.thumb_up,
                  active: myReaction == 'LIKE',
                  activeColor: AppTheme.accent,
                  count: likes,
                  onTap: () => _react('LIKE'),
                ),
                const SizedBox(width: 18),
                ReactionButton(
                  icon: Icons.thumb_down_outlined,
                  activeIcon: Icons.thumb_down,
                  active: myReaction == 'DISLIKE',
                  activeColor: Colors.redAccent,
                  count: dislikes,
                  onTap: () => _react('DISLIKE'),
                ),
              ],
            ),
          ),
          if (description != null && description.isNotEmpty) ...[
            const SizedBox(height: 14),
            StaggeredItem(
              index: 2,
              child: Text(
                description,
                style: const TextStyle(color: AppTheme.muted, height: 1.5),
              ),
            ),
          ],
          const SizedBox(height: 20),
          StaggeredItem(
            index: 3,
            child: Row(
              children: [
                const Text(
                  'Videos',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                ),
                const SizedBox(width: 8),
                Text('${lessons.length}', style: const TextStyle(color: AppTheme.muted)),
                const Spacer(),
                if (!unlocked)
                  const Text(
                    'Free previews play above',
                    style: TextStyle(fontSize: 12, color: AppTheme.accent),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          ...lessons.asMap().entries.map((e) {
            final lesson = e.value;
            final canWatch = _canWatch(lesson, unlocked);
            final isPreview = lesson['isFreePreview'] == true;
            final isActive = activeId == lesson['id']?.toString();

            return StaggeredItem(
              index: e.key + 4,
              child: Container(
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(
                  color: isActive ? AppTheme.card : AppTheme.background,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: isActive
                        ? AppTheme.accent.withValues(alpha: 0.5)
                        : canWatch
                            ? AppTheme.cardBorder
                            : AppTheme.cardBorder.withValues(alpha: 0.6),
                  ),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => _selectLesson(lesson, unlocked),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Row(
                      children: [
                        LessonCover(
                          lesson: lesson,
                          width: 112,
                          height: 64,
                          active: isActive,
                          showPlay: canWatch,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${e.key + 1}. ${lesson['title'] ?? 'Lesson'}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                                  color: canWatch ? AppTheme.foreground : AppTheme.muted,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  if (isPreview && !unlocked)
                                    Container(
                                      margin: const EdgeInsets.only(right: 8),
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 7, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: Colors.green.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: const Text(
                                        'FREE',
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.greenAccent,
                                        ),
                                      ),
                                    ),
                                  if (!canWatch)
                                    const Icon(Icons.lock_outline,
                                        size: 14, color: AppTheme.muted),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Column(
                          children: [
                            ReactionButton(
                              icon: Icons.thumb_up_outlined,
                              activeIcon: Icons.thumb_up,
                              active: lesson['likedByMe'] == true,
                              activeColor: AppTheme.accent,
                              count: (lesson['likes'] as num?)?.toInt() ?? 0,
                              onTap: () => _toggleLessonLike(lesson),
                            ),
                            const SizedBox(height: 6),
                            GestureDetector(
                              onTap: () => _toggleLessonFavorite(lesson),
                              child: Icon(
                                lesson['favoritedByMe'] == true
                                    ? Icons.favorite
                                    : Icons.favorite_border,
                                size: 18,
                                color: lesson['favoritedByMe'] == true
                                    ? Colors.redAccent
                                    : AppTheme.muted,
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
          }),
          if (unlocked && _quizzes.isNotEmpty) ...[
            const SizedBox(height: 20),
            StaggeredItem(
              index: lessons.length + 4,
              child: Row(
                children: [
                  const Text(
                    'Quizzes',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(width: 8),
                  Text('${_quizzes.length}', style: const TextStyle(color: AppTheme.muted)),
                ],
              ),
            ),
            const SizedBox(height: 10),
            ..._quizzes.asMap().entries.map((e) {
              final quiz = e.value;
              final locale = context.read<AuthProvider>().user?.locale ?? 'AR';
              final title = localizedText(quiz, locale);
              final qCount = (quiz['_count']?['questions'] as num?)?.toInt() ?? 0;
              return StaggeredItem(
                index: e.key + lessons.length + 5,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.card,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.cardBorder),
                  ),
                  child: ListTile(
                    leading: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
                    title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '$qCount questions · pass ${(quiz['passPercentage'] as num?)?.toInt() ?? 50}%',
                      style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                    ),
                    trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => QuizScreen(
                          quizId: quiz['id'].toString(),
                          title: title,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            }),
          ],
          if (activeId != null) ...[
            const SizedBox(height: 20),
            LessonQASection(key: ValueKey(activeId), lessonId: activeId),
          ],
        ],
      ),
      bottomSheet: unlocked
          ? null
          : Container(
              padding: EdgeInsets.fromLTRB(
                  18, 12, 18, 12 + MediaQuery.of(context).padding.bottom),
              decoration: const BoxDecoration(
                color: AppTheme.card,
                border: Border(top: BorderSide(color: AppTheme.cardBorder)),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Full access',
                        style: TextStyle(fontSize: 12, color: AppTheme.muted),
                      ),
                      Text(
                        '${price.toStringAsFixed(0)} $currency',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.accent,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: purchaseStatus == 'PENDING'
                          ? OutlinedButton.icon(
                              onPressed: null,
                              icon: const Icon(Icons.hourglass_top, size: 18),
                              label: const Text('Awaiting confirmation'),
                            )
                          : FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: AppTheme.primary,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14),
                                ),
                              ),
                              onPressed: _buying ? null : _buy,
                              icon: const Icon(Icons.workspace_premium_outlined),
                              label: Text(_buying ? 'Requesting…' : 'Subscribe'),
                            ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
