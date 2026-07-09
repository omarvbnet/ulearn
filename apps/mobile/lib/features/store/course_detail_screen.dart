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
  List<Map<String, dynamic>> _materials = [];
  int _selectedTab = 0;
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
      final materials =
          ((course['materials'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

      setState(() {
        _course = {...?_course, ...course};
        _purchased = purchased;
        _isOwnCourse = isOwn;
        _favorited = data['favoritedByMe'] == true;
        _quizzes = quizzes;
        _materials = materials;
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

  List<Widget> _buildVideosQuizzesTab({
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required String? activeId,
    required dynamic l10n,
  }) {
    return _courseTimeline(lessons).asMap().entries.map((e) {
      final item = e.value;
      if (item.isQuiz) {
        if (!unlocked) return const SizedBox.shrink();
        final quiz = item.data;
        final title = localizedText(quiz, context.localeCode);
        return StaggeredItem(
          index: e.key + 5,
          child: _QuizTimelineCard(
            title: title,
            passPct: (quiz['passPercentage'] as num?)?.toInt() ?? 50,
            questionCount: (quiz['_count']?['questions'] as num?)?.toInt(),
            onTap: () => _openQuiz(quiz),
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
        index: e.key + 5,
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
    }).toList();
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
            child: _CourseProgressHeader(
              lessons: lessons,
              quizzesCount: _quizzes.length,
              completedCount: _completedLessonCount(lessons),
              unlocked: unlocked,
              l10n: l10n,
            ),
          ),
          const SizedBox(height: 14),
          StaggeredItem(
            index: 4,
            child: _CourseDetailTabs(
              selected: _selectedTab,
              onSelected: (i) => setState(() => _selectedTab = i),
              lessonsCount: lessons.length,
              quizzesCount: unlocked ? _quizzes.length : 0,
              materialsCount: unlocked ? _materials.length : 0,
              l10n: l10n,
            ),
          ),
          const SizedBox(height: 14),
          if (_selectedTab == 0)
            ..._buildVideosQuizzesTab(
              lessons: lessons,
              unlocked: unlocked,
              activeId: activeId,
              l10n: l10n,
            )
          else if (_selectedTab == 1)
            StaggeredItem(
              index: 5,
              child: _CourseQATab(
                lessons: lessons,
                activeLesson: active,
                unlocked: unlocked,
                onSelectLesson: (l) => _selectLesson(l, unlocked),
                lessonTitle: (l, i) => _lessonTitle(context, l, i),
              ),
            )
          else
            StaggeredItem(
              index: 5,
              child: _CourseMaterialsTab(
                materials: _materials,
                lessons: lessons,
                unlocked: unlocked,
                lessonTitle: (l, i) => _lessonTitle(context, l, i),
              ),
            ),
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

/// Course progress summary shown above the content tabs.
class _CourseProgressHeader extends StatelessWidget {
  const _CourseProgressHeader({
    required this.lessons,
    required this.quizzesCount,
    required this.completedCount,
    required this.unlocked,
    required this.l10n,
  });

  final List<Map<String, dynamic>> lessons;
  final int quizzesCount;
  final int completedCount;
  final bool unlocked;
  final dynamic l10n;

  @override
  Widget build(BuildContext context) {
    final total = lessons.length;
    final progress = total == 0 ? 0.0 : completedCount / total;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.18),
            AppTheme.card,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.trending_up_rounded, color: AppTheme.accent, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.t('mobile.store.courseProgress'),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.foreground,
                  ),
                ),
              ),
              if (unlocked && total > 0)
                Text(
                  '$completedCount/$total',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: Colors.greenAccent.withValues(alpha: 0.95),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: unlocked && total > 0 ? progress : null,
              minHeight: 8,
              backgroundColor: AppTheme.cardBorder,
              color: Colors.greenAccent,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              _ProgressStatChip(
                icon: Icons.play_lesson_outlined,
                label: l10n.t('student.videos'),
                value: '$total',
              ),
              if (quizzesCount > 0)
                _ProgressStatChip(
                  icon: Icons.quiz_outlined,
                  label: l10n.t('student.quizzes'),
                  value: '$quizzesCount',
                ),
              if (!unlocked)
                _ProgressStatChip(
                  icon: Icons.lock_open_outlined,
                  label: l10n.t('common.free'),
                  value: l10n.t('mobile.store.previewAvailable'),
                  accent: true,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ProgressStatChip extends StatelessWidget {
  const _ProgressStatChip({
    required this.icon,
    required this.label,
    required this.value,
    this.accent = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: accent
            ? AppTheme.accent.withValues(alpha: 0.12)
            : AppTheme.background.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: accent
              ? AppTheme.accent.withValues(alpha: 0.35)
              : AppTheme.cardBorder,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: accent ? AppTheme.accent : AppTheme.muted),
          const SizedBox(width: 6),
          Text(
            '$label · $value',
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: accent ? AppTheme.accent : AppTheme.muted,
            ),
          ),
        ],
      ),
    );
  }
}

class _CourseDetailTabs extends StatelessWidget {
  const _CourseDetailTabs({
    required this.selected,
    required this.onSelected,
    required this.lessonsCount,
    required this.quizzesCount,
    required this.materialsCount,
    required this.l10n,
  });

  final int selected;
  final ValueChanged<int> onSelected;
  final int lessonsCount;
  final int quizzesCount;
  final int materialsCount;
  final dynamic l10n;

  @override
  Widget build(BuildContext context) {
    final tabs = [
      (
        icon: Icons.play_circle_outline,
        label: l10n.t('mobile.store.tabVideosQuizzes'),
        count: lessonsCount + quizzesCount,
      ),
      (
        icon: Icons.forum_outlined,
        label: l10n.t('mobile.store.tabQA'),
        count: null,
      ),
      (
        icon: Icons.folder_open_outlined,
        label: l10n.t('mobile.store.tabDocuments'),
        count: materialsCount > 0 ? materialsCount : null,
      ),
    ];

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        children: List.generate(tabs.length, (i) {
          final tab = tabs[i];
          final active = selected == i;
          return Expanded(
            child: GestureDetector(
              onTap: () => onSelected(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                decoration: BoxDecoration(
                  gradient: active ? AppTheme.gradient : null,
                  color: active ? null : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: active
                      ? [
                          BoxShadow(
                            color: AppTheme.primary.withValues(alpha: 0.25),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ]
                      : null,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      tab.icon,
                      size: 18,
                      color: active ? Colors.white : AppTheme.muted,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      tab.label,
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                        color: active ? Colors.white : AppTheme.muted,
                        height: 1.2,
                      ),
                    ),
                    if (tab.count != null) ...[
                      const SizedBox(height: 3),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: active
                              ? Colors.white.withValues(alpha: 0.2)
                              : AppTheme.primary.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          '${tab.count}',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: active ? Colors.white : AppTheme.accent,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _QuizTimelineCard extends StatelessWidget {
  const _QuizTimelineCard({
    required this.title,
    required this.passPct,
    required this.questionCount,
    required this.onTap,
  });

  final String title;
  final int passPct;
  final int? questionCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: AppTheme.gradient,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.quiz_outlined, color: Colors.white, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        [
                          if (questionCount != null) '${l10n.t('quiz.questions')}: $questionCount',
                          '${l10n.t('quiz.passMark')} $passPct%',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppTheme.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CourseQATab extends StatefulWidget {
  const _CourseQATab({
    required this.lessons,
    required this.activeLesson,
    required this.unlocked,
    required this.onSelectLesson,
    required this.lessonTitle,
  });

  final List<Map<String, dynamic>> lessons;
  final Map<String, dynamic>? activeLesson;
  final bool unlocked;
  final ValueChanged<Map<String, dynamic>> onSelectLesson;
  final String Function(Map<String, dynamic> lesson, int index) lessonTitle;

  @override
  State<_CourseQATab> createState() => _CourseQATabState();
}

class _CourseQATabState extends State<_CourseQATab> {
  late Map<String, dynamic>? _selected =
      widget.activeLesson ?? (widget.lessons.isNotEmpty ? widget.lessons.first : null);

  @override
  void didUpdateWidget(_CourseQATab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.activeLesson != null &&
        widget.activeLesson!['id'] != _selected?['id']) {
      _selected = widget.activeLesson;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (!widget.unlocked) {
      return _LockedTabPlaceholder(
        icon: Icons.forum_outlined,
        message: l10n.storeSubscribeUnlock,
      );
    }
    if (widget.lessons.isEmpty) {
      return _EmptyTabPlaceholder(
        icon: Icons.forum_outlined,
        title: l10n.t('student.noQuestions'),
      );
    }

    final selected = _selected ?? widget.lessons.first;
    final selectedId = selected['id']?.toString() ?? '';
    final selectedIndex = widget.lessons.indexWhere(
      (l) => l['id']?.toString() == selectedId,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.t('mobile.store.selectLessonForQa'),
          style: const TextStyle(fontSize: 12, color: AppTheme.muted),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 38,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: widget.lessons.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final lesson = widget.lessons[i];
              final active = i == selectedIndex;
              return FilterChip(
                selected: active,
                showCheckmark: false,
                label: Text(
                  widget.lessonTitle(lesson, i),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                selectedColor: AppTheme.accent.withValues(alpha: 0.2),
                backgroundColor: AppTheme.card,
                side: BorderSide(
                  color: active ? AppTheme.accent : AppTheme.cardBorder,
                ),
                labelStyle: TextStyle(
                  fontSize: 12,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: active ? AppTheme.accent : AppTheme.muted,
                ),
                onSelected: (_) {
                  setState(() => _selected = lesson);
                  widget.onSelectLesson(lesson);
                },
              );
            },
          ),
        ),
        const SizedBox(height: 16),
        LessonQASection(key: ValueKey(selectedId), lessonId: selectedId),
      ],
    );
  }
}

class _CourseMaterialsTab extends StatelessWidget {
  const _CourseMaterialsTab({
    required this.materials,
    required this.lessons,
    required this.unlocked,
    required this.lessonTitle,
  });

  final List<Map<String, dynamic>> materials;
  final List<Map<String, dynamic>> lessons;
  final bool unlocked;
  final String Function(Map<String, dynamic> lesson, int index) lessonTitle;

  String _lessonNameFor(String? lessonId) {
    if (lessonId == null) return '';
    final idx = lessons.indexWhere((l) => l['id']?.toString() == lessonId);
    if (idx < 0) return '';
    return lessonTitle(lessons[idx], idx);
  }

  IconData _iconForType(String? type) {
    return switch (type?.toUpperCase()) {
      'PDF' => Icons.picture_as_pdf_rounded,
      'VIDEO' => Icons.videocam_outlined,
      _ => Icons.insert_drive_file_outlined,
    };
  }

  Color _colorForType(String? type) {
    return switch (type?.toUpperCase()) {
      'PDF' => Colors.redAccent,
      'VIDEO' => AppTheme.primary,
      _ => AppTheme.accent,
    };
  }

  String _formatSize(int? bytes) {
    if (bytes == null || bytes <= 0) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (!unlocked) {
      return _LockedTabPlaceholder(
        icon: Icons.folder_off_outlined,
        message: l10n.storeSubscribeUnlock,
      );
    }
    if (materials.isEmpty) {
      return _EmptyTabPlaceholder(
        icon: Icons.folder_open_outlined,
        title: l10n.t('mobile.store.noMaterials'),
        subtitle: l10n.t('mobile.store.noMaterialsHint'),
      );
    }

    return Column(
      children: materials.map((m) {
        final type = m['type']?.toString();
        final lessonName = _lessonNameFor(m['lessonId']?.toString());
        final size = _formatSize((m['fileSize'] as num?)?.toInt());
        final url = m['fileUrl']?.toString();

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppTheme.cardBorder),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: url != null && url.isNotEmpty
                  ? () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(l10n.t('mobile.store.materialOpening')),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    }
                  : null,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: _colorForType(type).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(_iconForType(type), color: _colorForType(type), size: 24),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            m['title']?.toString() ?? l10n.t('student.materials'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            [
                              type ?? 'FILE',
                              if (size.isNotEmpty) size,
                              if (lessonName.isNotEmpty) lessonName,
                            ].join(' · '),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      url != null && url.isNotEmpty
                          ? Icons.download_rounded
                          : Icons.lock_outline,
                      color: AppTheme.muted,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _LockedTabPlaceholder extends StatelessWidget {
  const _LockedTabPlaceholder({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, size: 40, color: AppTheme.muted.withValues(alpha: 0.5)),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.muted, height: 1.4),
          ),
        ],
      ),
    );
  }
}

class _EmptyTabPlaceholder extends StatelessWidget {
  const _EmptyTabPlaceholder({
    required this.icon,
    required this.title,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 32, color: AppTheme.accent.withValues(alpha: 0.8)),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(
              subtitle!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
            ),
          ],
        ],
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
    final likes = (lesson['likes'] as num?)?.toInt() ?? 0;
    final saves = (lesson['favoritesCount'] as num?)?.toInt() ?? 0;

    final (statusLabel, statusColor) = switch (true) {
      _ when isCompleted => (l10n.t('quiz.passed'), Colors.greenAccent),
      _ when inProgress => ('${progressPct.round()}%', AppTheme.accent),
      _ when canWatch => (l10n.t('student.start'), AppTheme.muted),
      _ => (l10n.t('common.locked'), Colors.orangeAccent),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isActive
              ? AppTheme.accent.withValues(alpha: 0.6)
              : isCompleted
                  ? Colors.greenAccent.withValues(alpha: 0.3)
                  : AppTheme.cardBorder,
          width: isActive ? 1.5 : 1,
        ),
        boxShadow: isActive
            ? [
                BoxShadow(
                  color: AppTheme.accent.withValues(alpha: 0.12),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LessonCover(
                  lesson: lesson,
                  index: index,
                  width: 128,
                  height: 72,
                  borderRadius: 12,
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
                          fontSize: 14.5,
                          fontWeight: isActive ? FontWeight.w800 : FontWeight.w700,
                          color: AppTheme.foreground,
                          height: 1.35,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 10,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _LessonDetailChip(
                            icon: Icons.schedule_rounded,
                            label: _durationLabel,
                          ),
                          _LessonDetailChip(
                            icon: Icons.thumb_up_alt_outlined,
                            label: l10n.homeLikes(likes),
                          ),
                          _LessonDetailChip(
                            icon: Icons.bookmark_border_rounded,
                            label: l10n.homeSaves(saves),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  isCompleted
                                      ? Icons.check_circle_rounded
                                      : canWatch
                                          ? Icons.play_circle_outline
                                          : Icons.lock_outline,
                                  size: 13,
                                  color: statusColor,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  statusLabel,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: statusColor,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (showFreeBadge) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.greenAccent.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                l10n.t('common.free'),
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.greenAccent,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (inProgress) ...[
                        const SizedBox(height: 10),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: progressPct / 100,
                            minHeight: 5,
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
                    _LessonActionButton(
                      icon: lesson['likedByMe'] == true
                          ? Icons.thumb_up
                          : Icons.thumb_up_outlined,
                      active: lesson['likedByMe'] == true,
                      activeColor: AppTheme.accent,
                      onTap: onLike,
                    ),
                    _LessonActionButton(
                      icon: lesson['favoritedByMe'] == true
                          ? Icons.favorite
                          : Icons.favorite_border,
                      active: lesson['favoritedByMe'] == true,
                      activeColor: Colors.redAccent,
                      onTap: onFavorite,
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

class _LessonDetailChip extends StatelessWidget {
  const _LessonDetailChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: AppTheme.muted),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: AppTheme.muted,
          ),
        ),
      ],
    );
  }
}

class _LessonActionButton extends StatelessWidget {
  const _LessonActionButton({
    required this.icon,
    required this.active,
    required this.activeColor,
    required this.onTap,
  });

  final IconData icon;
  final bool active;
  final Color activeColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(
            icon,
            size: 20,
            color: active ? activeColor : AppTheme.muted,
          ),
        ),
      ),
    );
  }
}
