import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/lesson_cover.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_inline_player.dart';
import 'package:ulearn/features/store/lesson_qa_section.dart';
import 'package:ulearn/features/quiz/quiz_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';
import 'package:ulearn/features/store/teacher_studio_screen.dart';

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
  bool _isOwnCourse = false;
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
      if (_canWatch(l, unlocked) && !_isLessonCompleted(l)) {
        _activeLesson = l;
        return;
      }
    }
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
      final isOwn = data['isOwnCourse'] == true;
      final unlocked = purchased || course['purchaseStatus'] == 'PAID' || price <= 0 || isOwn;
      final lessons =
          ((course['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      final quizzes =
          ((data['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

      setState(() {
        _course = {...?_course, ...course};
        _purchased = purchased;
        _isOwnCourse = isOwn;
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
      setState(() => _error = context.l10n.t('mobile.error.generic'));
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
        SnackBar(
          content: Text(context.l10n.storeSubscriptionRequested),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? context.l10n.t('student.purchaseAlreadyRequested')
                : context.l10n.t('mobile.error.generic'),
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
        SnackBar(content: Text(context.l10n.storeSubscribeUnlock)),
      );
      return;
    }
    setState(() => _activeLesson = lesson);
  }

  Map<String, dynamic>? _nextWatchableLesson(
    List<Map<String, dynamic>> lessons,
    bool unlocked, {
    required Map<String, dynamic> current,
  }) {
    final currentId = current['id']?.toString();
    final idx = lessons.indexWhere((l) => l['id']?.toString() == currentId);
    if (idx < 0) return null;
    for (var i = idx + 1; i < lessons.length; i++) {
      if (_canWatch(lessons[i], unlocked)) return lessons[i];
    }
    return null;
  }

  Map<String, dynamic>? _quizAfterLesson(String? lessonId) {
    if (lessonId == null) return null;
    for (final q in _quizzes) {
      if (q['afterLessonId']?.toString() == lessonId) return q;
    }
    return null;
  }

  void _openQuiz(Map<String, dynamic> quiz) {
    final locale = context.localeCode;
    final title = localizedText(quiz, locale);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => QuizScreen(
          quizId: quiz['id'].toString(),
          title: title,
        ),
      ),
    );
  }

  List<({bool isQuiz, Map<String, dynamic> data, int? lessonIndex})> _courseTimeline(
    List<Map<String, dynamic>> lessons,
  ) {
    final byAfter = <String, List<Map<String, dynamic>>>{};
    final endQuizzes = <Map<String, dynamic>>[];
    for (final q in _quizzes) {
      final after = q['afterLessonId']?.toString();
      if (after != null && after.isNotEmpty) {
        byAfter.putIfAbsent(after, () => []).add(q);
      } else {
        endQuizzes.add(q);
      }
    }

    final items = <({bool isQuiz, Map<String, dynamic> data, int? lessonIndex})>[];
    for (var i = 0; i < lessons.length; i++) {
      final lesson = lessons[i];
      items.add((isQuiz: false, data: lesson, lessonIndex: i));
      final lid = lesson['id']?.toString();
      if (lid != null) {
        for (final q in byAfter[lid] ?? []) {
          items.add((isQuiz: true, data: q, lessonIndex: null));
        }
      }
    }
    for (final q in endQuizzes) {
      items.add((isQuiz: true, data: q, lessonIndex: null));
    }
    return items;
  }

  void _onLessonCompleted(Map<String, dynamic> lesson) {
    final lessons =
        ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    final unlocked = _purchased ||
        _course?['purchaseStatus'] == 'PAID' ||
        ((_course?['price'] as num?)?.toDouble() ?? 0) <= 0 ||
        _isOwnCourse;

    setState(() {
      lesson['isCompleted'] = true;
      lesson['completed'] = true;
      lesson['progressPct'] = 100;
    });

    final quiz = _quizAfterLesson(lesson['id']?.toString());
    if (quiz != null) {
      final locale = context.localeCode;
      final quizTitle = localizedText(quiz, locale);
      Future.delayed(const Duration(milliseconds: 700), () {
        if (!mounted) return;
        showDialog<void>(
          context: context,
          builder: (ctx) {
            final l10n = ctx.l10n;
            return AlertDialog(
            backgroundColor: AppTheme.card,
            title: Text(l10n.storeVideoCompleted),
            content: Text(l10n.storeReadyForQuiz(quizTitle)),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  final next = _nextWatchableLesson(lessons, unlocked, current: lesson);
                  if (next != null && mounted) {
                    setState(() => _activeLesson = next);
                  }
                },
                child: Text(l10n.storeLater),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _openQuiz(quiz);
                },
                child: Text(l10n.storeGoToQuiz),
              ),
            ],
          );
          },
        );
      });
      return;
    }

    final next = _nextWatchableLesson(lessons, unlocked, current: lesson);
    if (next == null) return;

    Future.delayed(const Duration(milliseconds: 900), () {
      if (!mounted) return;
      setState(() => _activeLesson = next);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.l10n.storeUpNext(next['title']?.toString() ?? '')),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
    });
  }

  bool _isLessonCompleted(Map<String, dynamic> lesson) {
    if (lesson['isCompleted'] == true || lesson['completed'] == true) return true;
    return ((lesson['progressPct'] as num?)?.toDouble() ?? 0) >= 90;
  }

  String _lessonTitle(BuildContext context, Map<String, dynamic> lesson, int index) {
    final raw = lesson['title']?.toString().trim();
    if (raw != null && raw.isNotEmpty) return raw;
    return '${context.l10n.t('student.videos')} ${index + 1}';
  }

  int _completedLessonCount(List<Map<String, dynamic>> lessons) {
    return lessons.where(_isLessonCompleted).length;
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.localeCode;
    final l10n = context.l10n;
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
            l10n.t('student.teacher');
    final rating = (course['teacherRating'] as num?)?.toDouble() ?? 0;
    final views = (course['viewCount'] as num?)?.toInt() ?? 0;
    final subscribers = (course['subscribersCount'] as num?)?.toInt() ?? 0;
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
    final totalSec = (course['totalDurationSec'] as num?)?.toInt() ??
        lessons.fold<int>(
          0,
          (s, l) => s + ((l['durationSec'] as num?)?.toInt() ?? 0),
        );
    final unlocked = _purchased || purchaseStatus == 'PAID' || isFree || _isOwnCourse;
    final active = _activeLesson;
    final activeUrl = active?['fileUrl']?.toString();
    final activeId = active?['id']?.toString();

    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (!_isOwnCourse)
            IconButton(
              tooltip: l10n.reelsReportContent,
              icon: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
              onPressed: () => ReportContentSheet.show(
                context,
                targetType: 'STORE_COURSE',
                targetId: widget.courseId,
                contentTitle: title,
              ),
            ),
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
          if (_isOwnCourse) ...[
            StaggeredItem(
              index: 0,
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.primary.withValues(alpha: 0.22),
                      AppTheme.card,
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.school_outlined, color: AppTheme.accent),
                        const SizedBox(width: 8),
                        Text(
                          l10n.storeYourCourse,
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      [
                        '${l10n.t('common.status')}: ${(course['status']?.toString() ?? 'APPROVED').replaceAll('_', ' ')}',
                        l10n.t('student.videos'),
                        l10n.homeViews(views),
                        if (subscribers > 0) l10n.homeSubscribers(subscribers),
                      ].join(' · '),
                      style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => const TeacherStudioScreen()),
                            ),
                            icon: const Icon(Icons.video_call_outlined, size: 18),
                            label: Text(l10n.storeManageInStudio),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
          if (activeUrl != null && activeUrl.isNotEmpty) ...[
            CourseInlinePlayer(
              key: ValueKey(activeUrl),
              url: ApiClient.absoluteUrl(activeUrl),
              title: active?['title']?.toString() ?? l10n.t('student.videos'),
              lessonId: activeId,
              onCompleted: active != null ? () => _onLessonCompleted(active) : null,
            ),
            const SizedBox(height: 10),
            Text(
              active?['title']?.toString() ?? '',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppTheme.foreground,
                height: 1.3,
              ),
            ),
            if (active != null && _isLessonCompleted(active))
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  children: [
                    Icon(Icons.check_circle_rounded, size: 16, color: Colors.greenAccent.withValues(alpha: 0.9)),
                    const SizedBox(width: 6),
                    Text(
                      l10n.t('quiz.passed'),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.greenAccent.withValues(alpha: 0.9),
                      ),
                    ),
                  ],
                ),
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
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.lock_outline, color: Colors.white70, size: 40),
                  const SizedBox(height: 8),
                  Text(
                    l10n.storeSubscribeUnlock,
                    style: const TextStyle(color: Colors.white70),
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
                            rating > 0
                                ? rating.toStringAsFixed(1)
                                : l10n.t('rank.noRankings'),
                            style: const TextStyle(fontSize: 12.5, color: AppTheme.muted),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            '${l10n.homeViews(views)} · ${l10n.homeSubscribers(subscribers)} · ${formatDuration(totalSec)}',
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      l10n.t('student.videos'),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppTheme.foreground,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '${lessons.length}',
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const Spacer(),
                    if (unlocked && lessons.isNotEmpty)
                      Text(
                        '${_completedLessonCount(lessons)}/${lessons.length}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.greenAccent.withValues(alpha: 0.9),
                        ),
                      )
                    else if (!unlocked)
                      Text(
                        l10n.t('common.free'),
                        style: const TextStyle(fontSize: 12, color: AppTheme.accent),
                      ),
                  ],
                ),
                if (unlocked && lessons.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: lessons.isEmpty
                          ? 0
                          : _completedLessonCount(lessons) / lessons.length,
                      minHeight: 5,
                      backgroundColor: AppTheme.cardBorder,
                      color: Colors.greenAccent,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          ..._courseTimeline(lessons).asMap().entries.map((e) {
            final item = e.value;
            if (item.isQuiz) {
              if (!unlocked) return const SizedBox.shrink();
              final quiz = item.data;
              final locale = context.localeCode;
              final title = localizedText(quiz, locale);
              return StaggeredItem(
                index: e.key + 4,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.card,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
                  ),
                  child: ListTile(
                    leading: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
                    title: Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.foreground,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Text(
                      '${l10n.t('quiz.questions')} · ${l10n.t('quiz.passMark')} ${(quiz['passPercentage'] as num?)?.toInt() ?? 50}%',
                      style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                    ),
                    trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                    onTap: () => _openQuiz(quiz),
                  ),
                ),
              );
            }

            final lesson = item.data;
            final lessonIndex = item.lessonIndex ?? 0;
            final canWatch = _canWatch(lesson, unlocked);
            final isPreview = lesson['isFreePreview'] == true;
            final isActive = activeId == lesson['id']?.toString();
            final isCompleted = _isLessonCompleted(lesson);
            final progressPct =
                ((lesson['progressPct'] as num?)?.toDouble() ?? 0).clamp(0.0, 100.0);
            final duration = (lesson['durationSec'] as num?)?.toInt() ?? 0;
            final title = _lessonTitle(context, lesson, lessonIndex);

            return StaggeredItem(
              index: e.key + 4,
              child: _LessonVideoCard(
                index: lessonIndex,
                title: title,
                lesson: lesson,
                canWatch: canWatch,
                isPreview: isPreview,
                showFreeBadge: isPreview && !unlocked,
                isActive: isActive,
                isCompleted: isCompleted,
                progressPct: progressPct,
                duration: duration,
                onTap: () => _selectLesson(lesson, unlocked),
                onLike: () => _toggleLessonLike(lesson),
                onFavorite: () => _toggleLessonFavorite(lesson),
              ),
            );
          }),
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
                      Text(
                        l10n.t('student.enrolled'),
                        style: const TextStyle(fontSize: 12, color: AppTheme.muted),
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
                              label: Text(l10n.studentPurchasePending),
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
                              label: Text(_buying ? l10n.t('student.issuing') : l10n.subscribe),
                            ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

/// Compact lesson row: cover + title + duration + completion status.
class _LessonVideoCard extends StatelessWidget {
  const _LessonVideoCard({
    required this.index,
    required this.title,
    required this.lesson,
    required this.canWatch,
    required this.isPreview,
    required this.showFreeBadge,
    required this.isActive,
    required this.isCompleted,
    required this.progressPct,
    required this.duration,
    required this.onTap,
    required this.onLike,
    required this.onFavorite,
  });

  final int index;
  final String title;
  final Map<String, dynamic> lesson;
  final bool canWatch;
  final bool isPreview;
  final bool showFreeBadge;
  final bool isActive;
  final bool isCompleted;
  final double progressPct;
  final int duration;
  final VoidCallback onTap;
  final VoidCallback onLike;
  final VoidCallback onFavorite;

  String get _durationLabel => duration > 0 ? formatDuration(duration) : '—';

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final inProgress = !isCompleted && progressPct > 0 && canWatch;

    final (statusLabel, statusColor, statusBg) = switch (true) {
      _ when isCompleted => (l10n.t('quiz.passed'), Colors.greenAccent, Colors.greenAccent.withValues(alpha: 0.15)),
      _ when inProgress => ('${progressPct.round()}%', AppTheme.accent, AppTheme.accent.withValues(alpha: 0.12)),
      _ when canWatch => (l10n.t('student.start'), AppTheme.muted, AppTheme.cardBorder.withValues(alpha: 0.6)),
      _ => (l10n.t('common.locked'), Colors.orangeAccent, Colors.orangeAccent.withValues(alpha: 0.12)),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isActive
              ? AppTheme.accent.withValues(alpha: 0.55)
              : isCompleted
                  ? Colors.greenAccent.withValues(alpha: 0.25)
                  : AppTheme.cardBorder,
          width: isActive ? 1.5 : 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LessonCover(
                  lesson: lesson,
                  index: index,
                  width: 120,
                  height: 68,
                  borderRadius: 10,
                  active: isActive,
                  showPlay: canWatch,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${index + 1}. $title',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: isActive ? FontWeight.w800 : FontWeight.w700,
                          color: AppTheme.foreground,
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          _MetaBadge(
                            icon: Icons.schedule,
                            label: _durationLabel,
                            color: AppTheme.foreground,
                            background: AppTheme.background,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: _MetaBadge(
                              icon: isCompleted
                                  ? Icons.check_circle_rounded
                                  : canWatch
                                      ? Icons.play_circle_outline
                                      : Icons.lock_outline,
                              label: statusLabel,
                              color: statusColor,
                              background: statusBg,
                            ),
                          ),
                        ],
                      ),
                      if (showFreeBadge) ...[
                        const SizedBox(height: 6),
                        _MetaBadge(
                          icon: Icons.star_rounded,
                          label: l10n.t('common.free'),
                          color: Colors.greenAccent,
                          background: Colors.greenAccent.withValues(alpha: 0.12),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Text(
                        l10n.storeDurationLikesSaves(
                          _durationLabel,
                          (lesson['likes'] as num?)?.toInt() ?? 0,
                          (lesson['favoritesCount'] as num?)?.toInt() ?? 0,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppTheme.muted,
                          height: 1.3,
                        ),
                      ),
                      if (inProgress) ...[
                        const SizedBox(height: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(3),
                          child: LinearProgressIndicator(
                            value: progressPct / 100,
                            minHeight: 4,
                            backgroundColor: AppTheme.cardBorder,
                            color: AppTheme.accent,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    InkWell(
                      onTap: onLike,
                      borderRadius: BorderRadius.circular(20),
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: Icon(
                          lesson['likedByMe'] == true
                              ? Icons.thumb_up
                              : Icons.thumb_up_outlined,
                          size: 18,
                          color: lesson['likedByMe'] == true
                              ? AppTheme.accent
                              : AppTheme.muted,
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: onFavorite,
                      borderRadius: BorderRadius.circular(20),
                      child: Padding(
                        padding: const EdgeInsets.all(4),
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
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MetaBadge extends StatelessWidget {
  const _MetaBadge({
    required this.icon,
    required this.label,
    required this.color,
    required this.background,
  });

  final IconData icon;
  final String label;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
