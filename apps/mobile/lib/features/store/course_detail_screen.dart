import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';
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

class _CourseDetailScreenState extends State<CourseDetailScreen>
    with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _activeLesson;
  bool _purchased = false;
  bool _buying = false;
  bool _favorited = false;
  bool _isOwnCourse = false;
  List<Map<String, dynamic>> _quizzes = [];
  List<Map<String, dynamic>> _documents = [];
  String? _error;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _course = widget.summary != null ? Map.of(widget.summary!) : null;
    _load();
    _countView();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
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
        _documents = ((data['documents'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
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
      body: NestedScrollView(
        headerSliverBuilder: (context, innerBoxIsScrolled) => [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
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
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 16,
                                  ),
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
                            OutlinedButton.icon(
                              onPressed: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const TeacherStudioScreen(),
                                ),
                              ),
                              icon: const Icon(Icons.video_call_outlined, size: 18),
                              label: Text(l10n.storeManageInStudio),
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
                      onCompleted:
                          active != null ? () => _onLessonCompleted(active) : null,
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
                            Icon(
                              Icons.check_circle_rounded,
                              size: 16,
                              color: Colors.greenAccent.withValues(alpha: 0.9),
                            ),
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
                              teacherName.isNotEmpty
                                  ? teacherName[0].toUpperCase()
                                  : '?',
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
                              Text(
                                teacherName,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${l10n.homeViews(views)} · ${l10n.homeSubscribers(subscribers)} · ${formatDuration(totalSec)}',
                                style: const TextStyle(fontSize: 12.5, color: AppTheme.muted),
                              ),
                            ],
                          ),
                        ),
                        if (rating > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.amber.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.star_rounded, size: 14, color: Colors.amber),
                                const SizedBox(width: 3),
                                Text(
                                  rating.toStringAsFixed(1),
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
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
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
          SliverPersistentHeader(
            pinned: true,
            delegate: _CourseTabBarDelegate(
              tabController: _tabController,
              tabs: [
                Tab(
                  icon: const Icon(Icons.play_lesson_outlined, size: 20),
                  text: l10n.t('mobile.store.tabCurriculum'),
                ),
                Tab(
                  icon: const Icon(Icons.forum_outlined, size: 20),
                  text: l10n.t('mobile.store.tabQA'),
                ),
                Tab(
                  icon: const Icon(Icons.folder_open_outlined, size: 20),
                  text: l10n.t('mobile.store.tabDocuments'),
                ),
              ],
            ),
          ),
        ],
        body: TabBarView(
          controller: _tabController,
          children: [
            _CurriculumTab(
              lessons: lessons,
              unlocked: unlocked,
              activeId: activeId,
              completedCount: _completedLessonCount(lessons),
              timeline: _courseTimeline(lessons),
              canWatch: (lesson, u) => _canWatch(lesson, u),
              isLessonCompleted: _isLessonCompleted,
              lessonTitle: (lesson, index) => _lessonTitle(context, lesson, index),
              onSelectLesson: (lesson) => _selectLesson(lesson, unlocked),
              onLike: _toggleLessonLike,
              onFavorite: _toggleLessonFavorite,
              onOpenQuiz: _openQuiz,
              l10n: l10n,
            ),
            _CourseQATab(
              lessons: lessons,
              activeId: activeId,
              unlocked: unlocked,
              onSelectLesson: (lesson) => _selectLesson(lesson, unlocked),
            ),
            _CourseDocumentsTab(
              documents: _documents,
              unlocked: unlocked,
              lessons: lessons,
            ),
          ],
        ),
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

/// Compact lesson row with cover, metadata, and engagement actions.
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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final inProgress = !isCompleted && progressPct > 0 && canWatch;
    final liked = lesson['likedByMe'] == true;
    final saved = lesson['favoritedByMe'] == true;
    final likes = (lesson['likes'] as num?)?.toInt() ?? 0;
    final saves = (lesson['favoritesCount'] as num?)?.toInt() ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.primary.withValues(alpha: 0.08) : AppTheme.card,
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
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14.5,
                                fontWeight: isActive ? FontWeight.w800 : FontWeight.w700,
                                color: AppTheme.foreground,
                                height: 1.35,
                              ),
                            ),
                          ),
                          if (isCompleted)
                            Padding(
                              padding: const EdgeInsets.only(left: 4),
                              child: Icon(
                                Icons.check_circle_rounded,
                                size: 18,
                                color: Colors.greenAccent.withValues(alpha: 0.9),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          if (duration > 0)
                            _DetailChip(
                              icon: Icons.schedule_rounded,
                              label: formatDuration(duration),
                            ),
                          if (likes > 0)
                            _DetailChip(
                              icon: Icons.thumb_up_alt_outlined,
                              label: formatCount(likes),
                            ),
                          if (saves > 0)
                            _DetailChip(
                              icon: Icons.bookmark_outline,
                              label: formatCount(saves),
                            ),
                          if (showFreeBadge)
                            _DetailChip(
                              icon: Icons.star_rounded,
                              label: l10n.t('common.free'),
                              color: Colors.greenAccent,
                            ),
                          if (!canWatch)
                            _DetailChip(
                              icon: Icons.lock_outline,
                              label: l10n.t('common.locked'),
                              color: Colors.orangeAccent,
                            )
                          else if (inProgress)
                            _DetailChip(
                              icon: Icons.play_circle_outline,
                              label: '${progressPct.round()}%',
                              color: AppTheme.accent,
                            )
                          else if (isCompleted)
                            _DetailChip(
                              icon: Icons.check_rounded,
                              label: l10n.t('quiz.passed'),
                              color: Colors.greenAccent,
                            ),
                        ],
                      ),
                      if (inProgress) ...[
                        const SizedBox(height: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
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
                const SizedBox(width: 4),
                Column(
                  children: [
                    _ActionIcon(
                      icon: liked ? Icons.thumb_up : Icons.thumb_up_outlined,
                      active: liked,
                      color: AppTheme.accent,
                      onTap: onLike,
                    ),
                    const SizedBox(height: 4),
                    _ActionIcon(
                      icon: saved ? Icons.bookmark : Icons.bookmark_border,
                      active: saved,
                      color: Colors.redAccent,
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

class _DetailChip extends StatelessWidget {
  const _DetailChip({
    required this.icon,
    required this.label,
    this.color,
  });

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppTheme.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: c.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: c),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c),
          ),
        ],
      ),
    );
  }
}

class _ActionIcon extends StatelessWidget {
  const _ActionIcon({
    required this.icon,
    required this.active,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final bool active;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(icon, size: 20, color: active ? color : AppTheme.muted),
      ),
    );
  }
}

class _CourseTabBarDelegate extends SliverPersistentHeaderDelegate {
  _CourseTabBarDelegate({required this.tabController, required this.tabs});

  final TabController tabController;
  final List<Tab> tabs;

  @override
  double get minExtent => 52;

  @override
  double get maxExtent => 52;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Material(
      color: AppTheme.background,
      elevation: overlapsContent ? 2 : 0,
      child: Container(
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppTheme.cardBorder)),
        ),
        child: TabBar(
          controller: tabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelColor: AppTheme.accent,
          unselectedLabelColor: AppTheme.muted,
          indicatorColor: AppTheme.accent,
          indicatorWeight: 3,
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
          unselectedLabelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
          tabs: tabs,
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _CourseTabBarDelegate old) =>
      old.tabController != tabController || old.tabs != tabs;
}

class _CurriculumTab extends StatelessWidget {
  const _CurriculumTab({
    required this.lessons,
    required this.unlocked,
    required this.activeId,
    required this.completedCount,
    required this.timeline,
    required this.canWatch,
    required this.isLessonCompleted,
    required this.lessonTitle,
    required this.onSelectLesson,
    required this.onLike,
    required this.onFavorite,
    required this.onOpenQuiz,
    required this.l10n,
  });

  final List<Map<String, dynamic>> lessons;
  final bool unlocked;
  final String? activeId;
  final int completedCount;
  final List<({bool isQuiz, Map<String, dynamic> data, int? lessonIndex})> timeline;
  final bool Function(Map<String, dynamic> lesson, bool unlocked) canWatch;
  final bool Function(Map<String, dynamic> lesson) isLessonCompleted;
  final String Function(Map<String, dynamic> lesson, int index) lessonTitle;
  final void Function(Map<String, dynamic> lesson) onSelectLesson;
  final Future<void> Function(Map<String, dynamic> lesson) onLike;
  final Future<void> Function(Map<String, dynamic> lesson) onFavorite;
  final void Function(Map<String, dynamic> quiz) onOpenQuiz;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
      children: [
        Row(
          children: [
            Text(
              l10n.t('student.videos'),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
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
                '$completedCount/${lessons.length}',
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
              value: completedCount / lessons.length,
              minHeight: 5,
              backgroundColor: AppTheme.cardBorder,
              color: Colors.greenAccent,
            ),
          ),
        ],
        const SizedBox(height: 16),
        ...timeline.asMap().entries.map((e) {
          final item = e.value;
          if (item.isQuiz) {
            if (!unlocked) return const SizedBox.shrink();
            final quiz = item.data;
            final quizTitle = localizedText(quiz, context.localeCode);
            final qCount = (quiz['_count'] as Map<String, dynamic>?)?['questions'] as num?;
            final questionCount = qCount?.toInt() ?? 0;
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
              ),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                leading: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
                ),
                title: Text(
                  quizTitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  '${l10n.t('quiz.questions')}: $questionCount · ${l10n.t('quiz.passMark')} ${(quiz['passPercentage'] as num?)?.toInt() ?? 50}%',
                  style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                ),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: () => onOpenQuiz(quiz),
              ),
            );
          }

          final lesson = item.data;
          final lessonIndex = item.lessonIndex ?? 0;
          final watchable = canWatch(lesson, unlocked);
          final isPreview = lesson['isFreePreview'] == true;
          final isActive = activeId == lesson['id']?.toString();
          final completed = isLessonCompleted(lesson);
          final progress =
              ((lesson['progressPct'] as num?)?.toDouble() ?? 0).clamp(0.0, 100.0);
          final duration = (lesson['durationSec'] as num?)?.toInt() ?? 0;
          final title = '${lessonIndex + 1}. ${lessonTitle(lesson, lessonIndex)}';

          return _LessonVideoCard(
            index: lessonIndex,
            title: title,
            lesson: lesson,
            canWatch: watchable,
            isPreview: isPreview,
            showFreeBadge: isPreview && !unlocked,
            isActive: isActive,
            isCompleted: completed,
            progressPct: progress,
            duration: duration,
            onTap: () => onSelectLesson(lesson),
            onLike: () => onLike(lesson),
            onFavorite: () => onFavorite(lesson),
          );
        }),
      ],
    );
  }
}

class _CourseQATab extends StatefulWidget {
  const _CourseQATab({
    required this.lessons,
    required this.activeId,
    required this.unlocked,
    required this.onSelectLesson,
  });

  final List<Map<String, dynamic>> lessons;
  final String? activeId;
  final bool unlocked;
  final void Function(Map<String, dynamic> lesson) onSelectLesson;

  @override
  State<_CourseQATab> createState() => _CourseQATabState();
}

class _CourseQATabState extends State<_CourseQATab> {
  String? _selectedLessonId;

  @override
  void initState() {
    super.initState();
    _selectedLessonId = widget.activeId ??
        (widget.lessons.isNotEmpty ? widget.lessons.first['id']?.toString() : null);
  }

  @override
  void didUpdateWidget(covariant _CourseQATab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.activeId != null && widget.activeId != _selectedLessonId) {
      _selectedLessonId = widget.activeId;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    if (widget.lessons.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            l10n.t('mobile.store.noLessonsForQA'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.muted),
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
      children: [
        Text(
          l10n.t('mobile.store.selectLessonForQA'),
          style: const TextStyle(fontSize: 13, color: AppTheme.muted),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 40,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: widget.lessons.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final lesson = widget.lessons[i];
              final id = lesson['id']?.toString() ?? '';
              final selected = id == _selectedLessonId;
              final title = lesson['title']?.toString().trim();
              final label = (title != null && title.isNotEmpty)
                  ? title
                  : '${l10n.t('student.videos')} ${i + 1}';
              return FilterChip(
                selected: selected,
                label: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                selectedColor: AppTheme.accent.withValues(alpha: 0.2),
                checkmarkColor: AppTheme.accent,
                onSelected: (_) {
                  setState(() => _selectedLessonId = id);
                  widget.onSelectLesson(lesson);
                },
              );
            },
          ),
        ),
        const SizedBox(height: 20),
        if (_selectedLessonId != null)
          LessonQASection(key: ValueKey(_selectedLessonId), lessonId: _selectedLessonId!),
      ],
    );
  }
}

class _CourseDocumentsTab extends StatelessWidget {
  const _CourseDocumentsTab({
    required this.documents,
    required this.unlocked,
    required this.lessons,
  });

  final List<Map<String, dynamic>> documents;
  final bool unlocked;
  final List<Map<String, dynamic>> lessons;

  IconData _iconFor(String? mime) {
    final m = mime?.toLowerCase() ?? '';
    if (m.contains('pdf')) return Icons.picture_as_pdf_rounded;
    if (m.contains('word') || m.contains('doc')) return Icons.description_outlined;
    if (m.contains('sheet') || m.contains('excel') || m.contains('xls')) {
      return Icons.table_chart_outlined;
    }
    if (m.contains('presentation') || m.contains('ppt')) return Icons.slideshow_outlined;
    if (m.contains('zip')) return Icons.folder_zip_outlined;
    if (m.contains('image')) return Icons.image_outlined;
    return Icons.insert_drive_file_outlined;
  }

  String _formatSize(int? bytes) {
    if (bytes == null || bytes <= 0) return '';
    if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    if (bytes >= 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '$bytes B';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    if (!unlocked) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.lock_outline, size: 48, color: AppTheme.muted.withValues(alpha: 0.5)),
              const SizedBox(height: 16),
              Text(
                l10n.storeSubscribeUnlock,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppTheme.muted),
              ),
            ],
          ),
        ),
      );
    }

    if (documents.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.folder_open_outlined,
                size: 56,
                color: AppTheme.muted.withValues(alpha: 0.4),
              ),
              const SizedBox(height: 16),
              Text(
                l10n.t('mobile.store.noDocuments'),
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.t('mobile.store.noDocumentsHint'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.5),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
      itemCount: documents.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, i) {
        final doc = documents[i];
        final title = doc['title']?.toString() ?? l10n.t('student.materials');
        final fileName = doc['fileName']?.toString();
        final lessonTitle = doc['lessonTitle']?.toString();
        final mime = doc['mimeType']?.toString();
        final size = (doc['sizeBytes'] as num?)?.toInt();
        final url = doc['fileUrl']?.toString();

        return Material(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: url != null && url.isNotEmpty
                ? () async {
                    final uri = Uri.parse(ApiClient.absoluteUrl(url));
                    final messenger = ScaffoldMessenger.of(context);
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    } else {
                      await Clipboard.setData(ClipboardData(text: uri.toString()));
                      messenger.showSnackBar(
                        SnackBar(content: Text(l10n.t('mobile.store.documentOpening'))),
                      );
                    }
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
                      color: AppTheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(_iconFor(mime), color: AppTheme.accent, size: 26),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                        ),
                        if (fileName != null && fileName.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            fileName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                          ),
                        ],
                        const SizedBox(height: 4),
                        Text(
                          [
                            if (lessonTitle != null && lessonTitle.isNotEmpty) lessonTitle,
                            if (_formatSize(size).isNotEmpty) _formatSize(size),
                          ].join(' · '),
                          style: const TextStyle(fontSize: 11.5, color: AppTheme.muted),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.download_outlined, color: AppTheme.muted),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
