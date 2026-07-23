import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/course_video_cache.dart';
import 'package:ulearn/core/widgets/lesson_cover.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/quiz/quiz_inline_panel.dart';
import 'package:ulearn/features/quiz/quiz_screen.dart';
import 'package:ulearn/features/reels/teacher_profile_screen.dart';
import 'package:ulearn/features/report/report_content_sheet.dart';
import 'package:ulearn/features/store/course_certificate_card.dart';
import 'package:ulearn/features/store/course_evaluation_sheet.dart';
import 'package:ulearn/features/store/course_iap.dart';
import 'package:ulearn/features/store/course_inline_player.dart';
import 'package:ulearn/features/store/course_material_pdf_screen.dart';
import 'package:ulearn/features/store/lesson_qa_section.dart';
import 'package:ulearn/features/store/teacher_studio_screen.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_player_screen.dart';

enum _PlayerStage { playing, quiz, documents }

/// Store course detail with inline free-video playback, smart lesson covers,
/// fullscreen casting watermark, and per-video Q&A.
class CourseDetailScreen extends StatefulWidget {
  const CourseDetailScreen({
    super.key,
    required this.courseId,
    this.summary,
    this.initialLessonId,
    this.initialQuestionId,
    this.initialAnswerId,
    this.openQa = false,
  });

  final String courseId;
  final Map<String, dynamic>? summary;

  /// Deep-link: select this lesson when the course loads.
  final String? initialLessonId;

  /// Deep-link: open Q&A tab and highlight this question.
  final String? initialQuestionId;

  /// Deep-link: open Q&A with this answer context (scrolls to question).
  final String? initialAnswerId;

  /// Deep-link: jump to the Ask & Answer tab.
  final bool openQa;

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
  bool _qaComposerFocused = false;
  String? _error;
  bool _reacting = false;
  Map<String, dynamic>? _completion;
  Map<String, dynamic>? _certificate;
  bool _evaluationPromptShown = false;
  _PlayerStage _playerStage = _PlayerStage.playing;
  Map<String, dynamic>? _stageQuiz;
  List<Map<String, dynamic>> _stageDocs = [];
  /// Portrait: pinch zooms the whole player stage (content below moves).
  double _playerZoom = 1.0;
  double _playerZoomAtScaleStart = 1.0;
  String? _introUrl;
  String? _outroUrl;
  VideoProtectionController? _captureGuard;
  bool _captureBlocked = false;

  static const double _minPlayerZoom = 1.0;
  static const double _maxPlayerZoom = 2.15;

  @override
  void initState() {
    super.initState();
    _course = widget.summary != null ? Map.of(widget.summary!) : null;
    _load();
    _countView();
    WidgetsBinding.instance.addPostFrameCallback((_) => _enableCaptureGuard());
  }

  @override
  void dispose() {
    _captureGuard?.removeListener(_onCaptureGuardChanged);
    _captureGuard?.disable();
    VideoProtectionController.disableScreenHardening();
    super.dispose();
  }

  Future<void> _enableCaptureGuard() async {
    if (!mounted) return;
    final auth = context.read<AuthProvider>();
    final l10n = context.l10n;
    _captureGuard = videoProtectionFromAuth(
      auth: auth,
      fallbackName: l10n.t('mobile.roles.student'),
    )..addListener(_onCaptureGuardChanged);
    await ensureFreshProtectionIdentity(
      auth,
      _captureGuard!,
      l10n.t('mobile.roles.student'),
    );
    await _captureGuard!.enable();
    await VideoProtectionController.enableScreenHardening();
  }

  void _onCaptureGuardChanged() {
    if (!mounted || _captureGuard == null) return;
    final blocked =
        _captureGuard!.screenshotBlocked || _captureGuard!.isScreenCaptured;
    if (blocked != _captureBlocked) {
      setState(() => _captureBlocked = blocked);
    }
  }

  void _onQaComposerFocusChanged(bool focused) {
    if (_qaComposerFocused == focused) return;
    setState(() => _qaComposerFocused = focused);
  }

  bool _isWhiteboard(Map<String, dynamic> lesson) =>
      lesson['lessonType']?.toString() == 'WHITEBOARD';

  bool _canWatch(Map<String, dynamic> lesson, bool unlocked) {
    if (_isWhiteboard(lesson)) {
      final hasPackage = lesson['packageUrl'] != null ||
          lesson['whiteboardId'] != null ||
          lesson['whiteboardAssetId'] != null;
      if (lesson['canWatch'] == true && hasPackage) return true;
      final isPreview = lesson['isFreePreview'] == true;
      final timed = (lesson['freePreviewSec'] as num?)?.toInt() ?? 0;
      return (unlocked || isPreview || timed > 0) && hasPackage;
    }
    if (lesson['canWatch'] == true && lesson['fileUrl'] != null) return true;
    final isPreview = lesson['isFreePreview'] == true;
    final timed = (lesson['freePreviewSec'] as num?)?.toInt() ?? 0;
    return (unlocked || isPreview || timed > 0) && lesson['fileUrl'] != null;
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

      var introOutro = data['introOutro'] as Map<String, dynamic>?;
      // Older deploys / race: fetch clips separately if course payload has none.
      if (introOutro == null ||
          (introOutro['intro'] == null && introOutro['outro'] == null)) {
        try {
          if (!mounted) return;
          final clipData =
              await context.read<ApiClient>().get('/api/intro-outro');
          if (!mounted) return;
          introOutro = clipData['introOutro'] as Map<String, dynamic>?;
        } catch (_) {}
      }
      final intro = introOutro?['intro'] as Map<String, dynamic>?;
      final outro = introOutro?['outro'] as Map<String, dynamic>?;
      final introUrl = intro?['fileUrl']?.toString();
      final outroUrl = outro?['fileUrl']?.toString();
      if (introUrl != null && introUrl.isNotEmpty) {
        CourseVideoCache.prefetch(ApiClient.absoluteUrl(introUrl));
      }
      if (outroUrl != null && outroUrl.isNotEmpty) {
        CourseVideoCache.prefetch(ApiClient.absoluteUrl(outroUrl));
      }

      setState(() {
        _course = {
          ...?widget.summary,
          ...course,
          'lessons': lessons,
          'materials': materials,
          'favorites': data['favorites'] ?? course['favorites'],
          'likes': data['likes'] ?? course['likes'] ?? 0,
          'dislikes': data['dislikes'] ?? course['dislikes'] ?? 0,
          'myReaction': data['myReaction'] ?? course['myReaction'],
        };
        _purchased = purchased;
        _isOwnCourse = isOwn;
        _favorited = data['favoritedByMe'] == true;
        _quizzes = quizzes;
        _materials = materials;
        _completion = data['completion'] as Map<String, dynamic>?;
        _certificate = data['certificate'] as Map<String, dynamic>?;
        _introUrl = introUrl != null && introUrl.isNotEmpty
            ? ApiClient.absoluteUrl(introUrl)
            : null;
        _outroUrl = outroUrl != null && outroUrl.isNotEmpty
            ? ApiClient.absoluteUrl(outroUrl)
            : null;
        _error = null;
        _selectInitialLesson(lessons, unlocked);
        final deepLessonId = widget.initialLessonId;
        if (deepLessonId != null && deepLessonId.isNotEmpty) {
          final match = lessons.cast<Map<String, dynamic>?>().firstWhere(
                (l) => l?['id']?.toString() == deepLessonId,
                orElse: () => null,
              );
          if (match != null) _activeLesson = match;
        }
        if (widget.openQa ||
            (widget.initialQuestionId?.isNotEmpty == true) ||
            (widget.initialAnswerId?.isNotEmpty == true)) {
          _selectedTab = 2;
        }
      });
      final activeId = _activeLesson?['id']?.toString();
      for (var i = 0; i < lessons.length; i++) {
        if (lessons[i]['id']?.toString() == activeId) {
          CourseVideoCache.prefetchAround(
            lessons.map((l) => l['fileUrl']?.toString()).toList(),
            i,
          );
          break;
        }
      }
      _maybeShowEvaluation();
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
    if (course == null || _reacting) return;
    _reacting = true;

    final previous = {
      'likes': course['likes'],
      'dislikes': course['dislikes'],
      'myReaction': course['myReaction'],
    };

    setState(() {
      final mine = course['myReaction']?.toString();
      if (mine == type) {
        course['myReaction'] = null;
        final key = type == 'LIKE' ? 'likes' : 'dislikes';
        course[key] = ((course[key] as num?)?.toInt() ?? 0) - 1;
      } else {
        if (mine != null) {
          final oldKey = mine == 'LIKE' ? 'likes' : 'dislikes';
          course[oldKey] = ((course[oldKey] as num?)?.toInt() ?? 0) - 1;
        }
        course['myReaction'] = type;
        final key = type == 'LIKE' ? 'likes' : 'dislikes';
        course[key] = ((course[key] as num?)?.toInt() ?? 0) + 1;
      }
    });

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
    } catch (_) {
      if (!mounted) return;
      setState(() => course.addAll(previous));
    } finally {
      _reacting = false;
    }
  }

  Widget _buildLikeSaveRow({
    required int likes,
    required int dislikes,
    required String? myReaction,
    double favoriteSize = 36,
  }) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ReactionButton(
          icon: Icons.thumb_up_outlined,
          activeIcon: Icons.thumb_up,
          active: myReaction == 'LIKE',
          activeColor: AppTheme.accent,
          count: likes,
          onTap: _reacting ? () {} : () => _react('LIKE'),
        ),
        const SizedBox(width: 12),
        ReactionButton(
          icon: Icons.thumb_down_outlined,
          activeIcon: Icons.thumb_down,
          active: myReaction == 'DISLIKE',
          activeColor: Colors.redAccent,
          count: dislikes,
          onTap: _reacting ? () {} : () => _react('DISLIKE'),
        ),
        const SizedBox(width: 12),
        FavoriteButton(
          active: _favorited,
          onTap: _toggleFavorite,
          size: favoriteSize,
        ),
      ],
    );
  }

  Future<void> _toggleFavorite() async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
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
    if (!await requireAuth(context)) return;
    if (!mounted) return;
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
    if (!await requireAuth(context)) return;
    if (!mounted) return;
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
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    setState(() => _buying = true);
    try {
      final course = _course;
      if (shouldUseCourseIap(course)) {
        try {
          final iap = CourseIapPurchase(context.read<ApiClient>());
          final result = await iap.buy(
            courseId: widget.courseId,
            appleProductId: course?['appleProductId']?.toString(),
            googleProductId: course?['googleProductId']?.toString(),
          );
          iap.dispose();
          if (!mounted) return;
          setState(() {
            _course?['purchaseStatus'] = 'PAID';
            _purchased = true;
          });
          final expires = result['expiresAt']?.toString();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                expires != null && expires.isNotEmpty
                    ? context.l10n.t('mobile.store.subscribedUntil', {
                        'date': expires.split('T').first,
                      })
                    : context.l10n.t('mobile.store.subscribedOk'),
              ),
            ),
          );
          await _load();
          return;
        } catch (e) {
          final msg = e.toString();
          if (msg.contains('product_missing') ||
              msg.contains('store_unavailable')) {
            // Fall through to activation request.
          } else if (msg.contains('purchase_canceled')) {
            if (!mounted) return;
            return;
          } else {
            if (!mounted) return;
            // Surface StoreKit Sandbox messages (e.g. not authorised) clearly.
            final clean = msg
                .replaceFirst(RegExp(r'^StoreIapException:\s*'), '')
                .replaceFirst(RegExp(r'^Exception:\s*'), '')
                .replaceFirst(RegExp(r'^storekit_error:\s*'), '');
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(clean)),
            );
            return;
          }
        }
      }

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
    setState(() {
      _activeLesson = lesson;
      _playerStage = _PlayerStage.playing;
      _stageQuiz = null;
      _stageDocs = [];
    });
    final lessons =
        ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    final idx = lessons.indexWhere((l) => l['id'] == lesson['id']);
    if (idx >= 0 && !_isWhiteboard(lesson)) {
      CourseVideoCache.prefetchAround(
        lessons.map((l) => l['fileUrl']?.toString()).toList(),
        idx,
      );
    }
  }

  List<Map<String, dynamic>> _docsForLesson(String? lessonId) {
    if (lessonId == null) return const [];
    return _materials
        .where((m) => m['lessonId']?.toString() == lessonId)
        .toList()
      ..sort((a, b) =>
          ((a['sortOrder'] as num?)?.toInt() ?? 0)
              .compareTo((b['sortOrder'] as num?)?.toInt() ?? 0));
  }

  void _enterDocumentsOrAdvance(Map<String, dynamic> lesson) {
    final docs = _docsForLesson(lesson['id']?.toString());
    if (docs.isNotEmpty) {
      setState(() {
        _playerStage = _PlayerStage.documents;
        _stageDocs = docs;
        _stageQuiz = null;
      });
      return;
    }
    _advanceAfterLesson(lesson);
  }

  void _advanceAfterLesson(Map<String, dynamic> lesson) {
    final lessons =
        ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    final unlocked = _purchased ||
        _course?['purchaseStatus'] == 'PAID' ||
        ((_course?['price'] as num?)?.toDouble() ?? 0) <= 0 ||
        _isOwnCourse;
    final next = _nextWatchableLesson(lessons, unlocked, current: lesson);
    if (next == null) {
      setState(() {
        _playerStage = _PlayerStage.playing;
        _stageQuiz = null;
        _stageDocs = [];
      });
      Future.delayed(const Duration(milliseconds: 400), () async {
        if (!mounted) return;
        await _load();
      });
      return;
    }
    setState(() {
      _activeLesson = next;
      _playerStage = _PlayerStage.playing;
      _stageQuiz = null;
      _stageDocs = [];
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(context.l10n.storeUpNext(next['title']?.toString() ?? '')),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
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

  void _maybeShowEvaluation() {
    if (_isOwnCourse || _evaluationPromptShown) return;
    if (_completion?['pendingEvaluation'] != true) return;
    final course = _course;
    if (course == null) return;
    _evaluationPromptShown = true;
    final title = localizedText(course, context.localeCode);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      CourseEvaluationSheet.show(
        context,
        courseId: widget.courseId,
        courseTitle: title,
        onSubmitted: _load,
      );
    });
  }

  void _showEvaluationSheet() {
    final course = _course;
    if (course == null) return;
    CourseEvaluationSheet.show(
      context,
      courseId: widget.courseId,
      courseTitle: localizedText(course, context.localeCode),
      initialRating: (_completion?['myRating'] as num?)?.toInt(),
      onSubmitted: _load,
    );
  }

  Future<void> _openQuiz(Map<String, dynamic> quiz) async {
    final locale = context.localeCode;
    final title = localizedText(quiz, locale);
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => QuizScreen(
          quizId: quiz['id'].toString(),
          title: title,
        ),
      ),
    );
    if (!mounted) return;
    await _load();
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
    setState(() {
      lesson['isCompleted'] = true;
      lesson['completed'] = true;
      lesson['progressPct'] = 100;
    });

    final quiz = _quizAfterLesson(lesson['id']?.toString());
    if (quiz != null && quiz['passedByMe'] != true) {
      Future.delayed(const Duration(milliseconds: 600), () {
        if (!mounted) return;
        _openQuiz(quiz);
      });
      return;
    }

    Future.delayed(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      _enterDocumentsOrAdvance(lesson);
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

  void _openTeacherProfile(Map<String, dynamic>? teacher, String teacherName) {
    final teacherId = teacher?['id']?.toString();
    if (teacherId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TeacherProfileScreen(
          teacherId: teacherId,
          initialName: teacherName,
        ),
      ),
    );
  }

  Widget _buildSelectedTabContent({
    required Map<String, dynamic> course,
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required String? activeId,
    required dynamic l10n,
    required Map<String, dynamic>? active,
    required String teacherName,
    required double rating,
    required int views,
    required int subscribers,
    required int totalSec,
    required String? description,
    required Map<String, dynamic>? teacher,
    required VoidCallback onTeacherTap,
  }) {
    if (_selectedTab == 0) {
      return _CourseDetailsTab(
        course: course,
        teacherName: teacherName,
        rating: rating,
        views: views,
        subscribers: subscribers,
        totalSec: totalSec,
        description: description,
        lessons: lessons,
        quizzes: _quizzes,
        unlocked: unlocked,
        completion: _completion,
        certificate: _certificate,
        courseId: widget.courseId,
        activeLesson: active,
        activeVideoTitle: active != null
            ? _lessonTitle(
                context,
                active,
                () {
                  final i = lessons.indexWhere(
                    (l) => l['id']?.toString() == active['id']?.toString(),
                  );
                  return i >= 0 ? i : 0;
                }(),
              )
            : null,
        completedLessonCount: _completedLessonCount(lessons),
        isOwnCourse: _isOwnCourse,
        onTeacherTap: onTeacherTap,
        onEvaluate: _showEvaluationSheet,
        l10n: l10n,
      );
    }
    if (_selectedTab == 1) {
      final items = _buildVideosQuizzesTab(
        lessons: lessons,
        unlocked: unlocked,
        activeId: activeId,
        l10n: l10n,
      );
      return ListView(
        padding: const EdgeInsets.only(bottom: 12),
        children: items,
      );
    }
    if (_selectedTab == 2) {
      return _CourseQATab(
        lessons: lessons,
        activeLesson: active,
        unlocked: unlocked,
        onSelectLesson: (l) => _selectLesson(l, unlocked),
        lessonTitle: (l, i) => _lessonTitle(context, l, i),
        onComposerFocusChanged: _onQaComposerFocusChanged,
        highlightQuestionId: widget.initialQuestionId,
        autoFocusAnswer: widget.openQa &&
            (widget.initialQuestionId?.isNotEmpty == true),
      );
    }
    return _CourseMaterialsTab(
      materials: _materials,
      lessons: lessons,
      unlocked: unlocked,
      lessonTitle: (l, i) => _lessonTitle(context, l, i),
    );
  }

  /// Fixed stage shared by video, quiz, and documents.
  /// Portrait uses a slightly taller-than-16:9 frame; pinch zooms the stage height
  /// so widgets under the video move down / up with zoom.
  static const double _portraitStageAspect = 16 / 10;

  Widget _buildPlayerStage({
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required Map<String, dynamic>? active,
    required String? activeUrl,
    required String? activeId,
    required dynamic l10n,
    required bool collapse,
    required bool edgeToEdge,
  }) {
    final stageBody = AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      child: KeyedSubtree(
        key: ValueKey(
          '${_playerStage.name}-${_stageQuiz?['id']}-${activeId ?? 'none'}',
        ),
        child: _buildStageContent(
          lessons: lessons,
          unlocked: unlocked,
          active: active,
          activeUrl: activeUrl,
          activeId: activeId,
          l10n: l10n,
          edgeToEdge: edgeToEdge,
          expandPlayer: true,
          showFullscreen: false,
        ),
      ),
    );

    final zoomed = _playerZoom > 1.02;

    return ClipRect(
      child: AnimatedAlign(
        alignment: Alignment.topCenter,
        heightFactor: collapse ? 0.0 : 1.0,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeInOutCubic,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            final baseHeight = width / _portraitStageAspect;
            final height = baseHeight * _playerZoom;
            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              onScaleStart: (_) {
                _playerZoomAtScaleStart = _playerZoom;
              },
              onScaleUpdate: (details) {
                // Ignore tiny scale noise from finger tap jitter.
                if ((details.scale - 1).abs() < 0.01 &&
                    _playerZoomAtScaleStart == _playerZoom) {
                  return;
                }
                final next =
                    (_playerZoomAtScaleStart * details.scale)
                        .clamp(_minPlayerZoom, _maxPlayerZoom);
                if ((next - _playerZoom).abs() < 0.004) return;
                setState(() => _playerZoom = next);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 40),
                width: width,
                height: height,
                color: Colors.black,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    stageBody,
                    if (zoomed)
                      Positioned(
                        top: 8,
                        right: 8,
                        child: Material(
                          color: Colors.black.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(20),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(20),
                            onTap: () => setState(() => _playerZoom = 1.0),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(
                                    Icons.zoom_out_map_rounded,
                                    size: 16,
                                    color: Colors.white,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    l10n.t('mobile.store.resetPlayerSize'),
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildStageContent({
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required Map<String, dynamic>? active,
    required String? activeUrl,
    required String? activeId,
    required dynamic l10n,
    required bool edgeToEdge,
    bool expandPlayer = false,
    bool showFullscreen = true,
  }) {
    if (_playerStage == _PlayerStage.quiz && _stageQuiz != null) {
      return QuizInlinePanel(
        key: ValueKey('quiz-panel-${_stageQuiz!['id']}'),
        quizId: _stageQuiz!['id'].toString(),
        title: localizedText(_stageQuiz!, context.localeCode),
        embedded: true,
        onFinished: () {
          final lesson = _activeLesson;
          if (lesson == null) return;
          setState(() => _stageQuiz!['passedByMe'] = true);
          _enterDocumentsOrAdvance(lesson);
        },
      );
    }

    if (_playerStage == _PlayerStage.documents && _stageDocs.isNotEmpty) {
      return _LessonDocumentsPanel(
        materials: _stageDocs,
        embedded: true,
        onView: (m) {
          final url = m['fileUrl']?.toString();
          if (url == null || url.isEmpty) return;
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => CourseMaterialPdfScreen(
                title: m['title']?.toString() ??
                    l10n.t('mobile.teacher.documentFallback'),
                url: ApiClient.absoluteUrl(url),
              ),
            ),
          );
        },
        onNext: () {
          final lesson = _activeLesson;
          if (lesson == null) return;
          _advanceAfterLesson(lesson);
        },
      );
    }

    if (active != null && _isWhiteboard(active)) {
      final packageUrl = active['packageUrl']?.toString();
      final whiteboardId =
          active['whiteboardId']?.toString() ?? active['whiteboardAssetId']?.toString();
      return WhiteboardPlayerScreen(
        key: ValueKey('wb_${activeId}_${active['watchPositionSec']}'),
        lessonId: activeId ?? '',
        title: active['title']?.toString() ?? l10n.t('student.videos'),
        packageUrl: packageUrl,
        whiteboardId: whiteboardId,
        durationSec: (active['durationSec'] as num?)?.toInt(),
        initialPositionSec: (active['watchPositionSec'] as num?) != null &&
                !_isLessonCompleted(active)
            ? (active['watchPositionSec'] as num).toInt()
            : 0,
        freePreviewSec: !unlocked &&
                active['previewOnly'] == true &&
                (active['freePreviewSec'] as num?) != null
            ? (active['freePreviewSec'] as num).toInt()
            : null,
        onProgress: (pos, dur, completed) async {
          try {
            final api = context.read<ApiClient>();
            await api.post('/api/store/lessons/${activeId}/progress', {
              'positionSec': pos,
              'durationSec': dur,
              'completionPct': dur > 0 ? (pos / dur * 100).clamp(0, 100) : 0,
              'isCompleted': completed,
            });
            if (completed) _onLessonCompleted(active);
          } catch (_) {}
        },
      );
    }

    if (activeUrl != null && activeUrl.isNotEmpty) {
      return CourseInlinePlayer(
        // Include intro/outro in the key so the player remounts once clips load.
        key: ValueKey(
          '${activeUrl}_${active?['watchPositionSec']}_${_introUrl ?? ''}_${_outroUrl ?? ''}',
        ),
        url: ApiClient.absoluteUrl(activeUrl),
        title: active?['title']?.toString() ?? l10n.t('student.videos'),
        lessonId: activeId,
        courseId: widget.courseId,
        borderRadius: edgeToEdge ? 0 : 14,
        expand: expandPlayer,
        showFullscreen: showFullscreen,
        introUrl: _introUrl,
        outroUrl: _outroUrl,
        initiallyCompleted: active != null && _isLessonCompleted(active),
        initialPositionSec: active != null && !_isLessonCompleted(active)
            ? (active['watchPositionSec'] as num?)?.toInt()
            : null,
        onCompleted: active != null ? () => _onLessonCompleted(active) : null,
        playlist: [
          for (var i = 0; i < lessons.length; i++)
            CoursePlaylistItem(
              id: lessons[i]['id']?.toString() ?? '$i',
              title: _lessonTitle(context, lessons[i], i),
              canWatch: _canWatch(lessons[i], unlocked),
              completed: _isLessonCompleted(lessons[i]),
              durationLabel: formatDuration(
                (lessons[i]['durationSec'] as num?)?.toInt() ?? 0,
              ),
            ),
        ],
        onSelectPlaylistItem: (id) {
          Map<String, dynamic>? lesson;
          for (final l in lessons) {
            if (l['id']?.toString() == id) {
              lesson = l;
              break;
            }
          }
          if (lesson != null) _selectLesson(lesson, unlocked);
        },
        freePreviewLimitSec: !unlocked &&
                active?['previewOnly'] == true &&
                (active?['freePreviewSec'] as num?) != null
            ? (active!['freePreviewSec'] as num).toInt()
            : null,
        onPreviewLimitReached: !unlocked
            ? () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(l10n.t('mobile.store.previewEndedHint')),
                  ),
                );
              }
            : null,
      );
    }

    if (!unlocked) {
      return DecoratedBox(
        decoration: const BoxDecoration(gradient: AppTheme.gradient),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_outline, color: Colors.white70, size: 40),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(
                  l10n.storeSubscribeUnlock,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return ColoredBox(
      color: AppTheme.card,
      child: Center(
        child: Text(
          l10n.t('mobile.store.selectLessonHint'),
          style: TextStyle(color: AppTheme.muted),
        ),
      ),
    );
  }

  String _stageLabel(dynamic l10n) {
    return switch (_playerStage) {
      _PlayerStage.quiz => l10n.t('mobile.store.quizStep'),
      _PlayerStage.documents => l10n.t('mobile.store.documentsStep'),
      _PlayerStage.playing => l10n.t('mobile.store.currentVideo'),
    };
  }

  Widget _buildNowPlayingStrip({
    required Map<String, dynamic>? active,
    required String courseTitle,
    required dynamic l10n,
    bool theater = false,
  }) {
    final title = active != null
        ? _lessonTitle(
            context,
            active,
            () {
              final lessons = ((_course?['lessons'] as List<dynamic>?) ?? [])
                  .cast<Map<String, dynamic>>();
              final i = lessons.indexWhere(
                (l) => l['id']?.toString() == active['id']?.toString(),
              );
              return i >= 0 ? i : 0;
            }(),
          )
        : courseTitle;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
      decoration: BoxDecoration(
        color: theater
            ? const Color(0xFF0A0A12)
            : AppTheme.card.withValues(alpha: 0.55),
        border: Border(
          bottom: BorderSide(
            color: theater
                ? Colors.white.withValues(alpha: 0.08)
                : AppTheme.cardBorder.withValues(alpha: 0.7),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(7),
            ),
            child: Text(
              _stageLabel(l10n),
              style: const TextStyle(
                color: AppTheme.accent,
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14,
                color: theater ? Colors.white : AppTheme.foreground,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabsBar({
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required dynamic l10n,
  }) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: _CourseDetailTabs(
        selected: _selectedTab,
        onSelected: (i) {
          setState(() {
            _selectedTab = i;
            if (i != 2) _qaComposerFocused = false;
          });
        },
        lessonsCount: lessons.length,
        quizzesCount: _quizzes.length,
        materialsCount: unlocked ? _materials.length : 0,
        l10n: l10n,
      ),
    );
  }

  /// Landscape: left = fixed stage (video/quiz/docs), right = tabs + content.
  /// Always black theater chrome (never light/white sides around the video).
  Widget _buildLandscapeBody({
    required Map<String, dynamic> course,
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required Map<String, dynamic>? active,
    required String? activeUrl,
    required String? activeId,
    required String courseTitle,
    required dynamic l10n,
    required Widget tabContent,
  }) {
    return ColoredBox(
      color: Colors.black,
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Column(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: ColoredBox(
                        color: Colors.black,
                        child: _buildStageContent(
                          lessons: lessons,
                          unlocked: unlocked,
                          active: active,
                          activeUrl: activeUrl,
                          activeId: activeId,
                          l10n: l10n,
                          edgeToEdge: true,
                          expandPlayer: true,
                          showFullscreen: true,
                        ),
                      ),
                    ),
                  ),
                ),
                _buildNowPlayingStrip(
                  active: active,
                  courseTitle: courseTitle,
                  l10n: l10n,
                  theater: true,
                ),
              ],
            ),
          ),
          const VerticalDivider(
            width: 1,
            thickness: 1,
            color: Color(0xFF1A1A35),
          ),
          SizedBox(
            width: (MediaQuery.sizeOf(context).width * 0.38).clamp(280.0, 360.0),
            child: ColoredBox(
              color: const Color(0xFF0A0A12),
              child: Column(
                children: [
                  _buildTabsBar(
                    lessons: lessons,
                    unlocked: unlocked,
                    l10n: l10n,
                  ),
                  const SizedBox(height: 4),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                      child: tabContent,
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

  List<Widget> _buildVideosQuizzesTab({
    required List<Map<String, dynamic>> lessons,
    required bool unlocked,
    required String? activeId,
    required dynamic l10n,
  }) {
    return _courseTimeline(lessons).asMap().entries.map((e) {
      final item = e.value;
      if (item.isQuiz) {
        final quiz = item.data;
        final title = localizedText(quiz, context.localeCode);
        final passed = quiz['passedByMe'] == true;
        final qCount = (quiz['_count']?['questions'] as num?)?.toInt() ??
            (quiz['questions'] as List?)?.length;
        return Padding(
          key: ValueKey('quiz-${quiz['id']}'),
          padding: const EdgeInsets.only(bottom: 6),
          child: _QuizTimelineCard(
            title: title.isEmpty
                ? context.l10n.t('student.quizzes')
                : title,
            passPct: (quiz['passPercentage'] as num?)?.toInt() ?? 50,
            questionCount: qCount,
            locked: !unlocked,
            passed: passed,
            onTap: () {
              if (!unlocked) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(context.l10n.storeSubscribeUnlock)),
                );
                return;
              }
              // Always open the full exam screen from the curriculum list.
              _openQuiz(quiz);
            },
          ),
        );
      }

      final lesson = item.data;
      final lessonIndex = item.lessonIndex ?? 0;
      final canWatch = _canWatch(lesson, unlocked);
      final isPreview = lesson['isFreePreview'] == true;
      final freeSec = (lesson['freePreviewSec'] as num?)?.toInt() ?? 0;
      final isActive = activeId == lesson['id']?.toString();
      final isCompleted = _isLessonCompleted(lesson);
      final progressPct =
          ((lesson['progressPct'] as num?)?.toDouble() ?? 0).clamp(0.0, 100.0);
      final duration = (lesson['durationSec'] as num?)?.toInt() ?? 0;
      final title = _lessonTitle(context, lesson, lessonIndex);

      return Padding(
        key: ValueKey('lesson-${lesson['id']}'),
        padding: const EdgeInsets.only(bottom: 6),
        child: _LessonVideoCard(
          index: lessonIndex,
          title: title,
          lesson: lesson,
          canWatch: canWatch,
          isPreview: isPreview || freeSec > 0,
          showFreeBadge: (isPreview || freeSec > 0) && !unlocked,
          isActive: isActive,
          isCompleted: isCompleted,
          progressPct: progressPct,
          duration: duration,
          onTap: () => _selectLesson(lesson, unlocked),
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
        appBar: GlassAppBar(),
        body: _error != null
            ? Center(child: Text(_error!, style: TextStyle(color: AppTheme.muted)))
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

    final collapseStage = _selectedTab == 2 && _qaComposerFocused;
    final tabContent = _buildSelectedTabContent(
      course: course,
      lessons: lessons,
      unlocked: unlocked,
      activeId: activeId,
      l10n: l10n,
      active: active,
      teacherName: teacherName,
      rating: rating,
      views: views,
      subscribers: subscribers,
      totalSec: totalSec,
      description: description,
      teacher: teacher,
      onTeacherTap: () => _openTeacherProfile(teacher, teacherName),
    );

    final isLandscape =
        MediaQuery.orientationOf(context) == Orientation.landscape;

    return Stack(
      fit: StackFit.expand,
      children: [
        Scaffold(
      backgroundColor: isLandscape ? Colors.black : AppTheme.background,
      resizeToAvoidBottomInset: true,
      appBar: isLandscape
          ? null
          : GlassAppBar(
              title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
              actions: [
                if (!_isOwnCourse)
                  IconButton(
                    tooltip: l10n.reelsReportContent,
                    icon: const Icon(Icons.flag_outlined,
                        color: Colors.orangeAccent),
                    onPressed: () => ReportContentSheet.show(
                      context,
                      targetType: 'STORE_COURSE',
                      targetId: widget.courseId,
                      contentTitle: title,
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: _buildLikeSaveRow(
                    likes: likes,
                    dislikes: dislikes,
                    myReaction: myReaction,
                  ),
                ),
              ],
            ),
      body: isLandscape
          ? ColoredBox(
              color: Colors.black,
              child: SafeArea(
                child: Column(
                  children: [
                    // Compact landscape chrome — always black, light icons/text
                    SizedBox(
                      height: 44,
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(
                              Icons.arrow_back_ios_new_rounded,
                              size: 18,
                              color: Colors.white,
                            ),
                            onPressed: () => Navigator.of(context).maybePop(),
                          ),
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                                color: Colors.white,
                              ),
                            ),
                          ),
                          _buildLikeSaveRow(
                            likes: likes,
                            dislikes: dislikes,
                            myReaction: myReaction,
                            favoriteSize: 34,
                          ),
                          const SizedBox(width: 8),
                        ],
                      ),
                    ),
                    Expanded(
                      child: _buildLandscapeBody(
                        course: course,
                        lessons: lessons,
                        unlocked: unlocked,
                        active: active,
                        activeUrl: activeUrl,
                        activeId: activeId,
                        courseTitle: title,
                        l10n: l10n,
                        tabContent: tabContent,
                      ),
                    ),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                // Edge-to-edge YouTube-style stage (video / quiz / docs)
                _buildPlayerStage(
                  lessons: lessons,
                  unlocked: unlocked,
                  active: active,
                  activeUrl: activeUrl,
                  activeId: activeId,
                  l10n: l10n,
                  collapse: collapseStage,
                  edgeToEdge: true,
                ),
                if (!collapseStage)
                  _buildNowPlayingStrip(
                    active: active,
                    courseTitle: title,
                    l10n: l10n,
                  ),
                _buildTabsBar(
                  lessons: lessons,
                  unlocked: unlocked,
                  l10n: l10n,
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: tabContent,
                  ),
                ),
              ],
            ),
      bottomSheet: unlocked || isLandscape
          ? null
          : Container(
              padding: EdgeInsets.fromLTRB(
                  18, 12, 18, 12 + MediaQuery.of(context).padding.bottom),
              decoration: BoxDecoration(
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
                              label: Text(_buying
                                  ? l10n.t('student.issuing')
                                  : l10n.subscribe),
                            ),
                    ),
                  ),
                ],
              ),
            ),
        ),
        if (_captureBlocked)
          const Positioned.fill(
            child: ColoredBox(color: Colors.black),
          ),
      ],
    );
  }
}

/// Course progress summary pinned at the bottom of the detail screen.
class _CourseProgressHeader extends StatelessWidget {
  const _CourseProgressHeader({
    required this.lessons,
    required this.quizzesCount,
    required this.completedCount,
    required this.unlocked,
    required this.l10n,
    this.compact = false,
    this.pendingEvaluation = false,
    this.myRating,
    this.onEvaluate,
  });

  final List<Map<String, dynamic>> lessons;
  final int quizzesCount;
  final int completedCount;
  final bool unlocked;
  final dynamic l10n;
  final bool compact;
  final bool pendingEvaluation;
  final int? myRating;
  final VoidCallback? onEvaluate;

  @override
  Widget build(BuildContext context) {
    final total = lessons.length;
    final progress = total == 0 ? 0.0 : completedCount / total;

    return Container(
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.18),
            AppTheme.card,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(compact ? 14 : 16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(compact ? 6 : 8),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  Icons.trending_up_rounded,
                  color: AppTheme.accent,
                  size: compact ? 18 : 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.t('mobile.store.courseProgress'),
                  style: TextStyle(
                    fontSize: compact ? 14 : 16,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.foreground,
                  ),
                ),
              ),
              if (unlocked && total > 0)
                Text(
                  '$completedCount/$total',
                  style: TextStyle(
                    fontSize: compact ? 13 : 14,
                    fontWeight: FontWeight.w700,
                    color: Colors.greenAccent.withValues(alpha: 0.95),
                  ),
                ),
            ],
          ),
          SizedBox(height: compact ? 8 : 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: unlocked && total > 0 ? progress : null,
              minHeight: compact ? 6 : 8,
              backgroundColor: AppTheme.cardBorder,
              color: Colors.greenAccent,
            ),
          ),
          if (!compact) ...[
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
          if (pendingEvaluation && onEvaluate != null) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onEvaluate,
                icon: const Icon(Icons.star_rounded, size: 18),
                label: Text(l10n.t('mobile.store.tapToEvaluate')),
              ),
            ),
          ] else if (myRating != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.star_rounded, size: 16, color: Colors.amber),
                const SizedBox(width: 6),
                Text(
                  l10n.t('mobile.store.yourRating', {'rating': '$myRating'}),
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.muted,
                  ),
                ),
              ],
            ),
          ],
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

class _CourseDetailsTab extends StatelessWidget {
  const _CourseDetailsTab({
    required this.course,
    required this.teacherName,
    required this.rating,
    required this.views,
    required this.subscribers,
    required this.totalSec,
    required this.description,
    required this.lessons,
    required this.quizzes,
    required this.unlocked,
    required this.completion,
    required this.certificate,
    required this.courseId,
    required this.activeLesson,
    required this.activeVideoTitle,
    required this.completedLessonCount,
    required this.isOwnCourse,
    required this.onTeacherTap,
    required this.onEvaluate,
    required this.l10n,
  });

  final Map<String, dynamic> course;
  final String teacherName;
  final double rating;
  final int views;
  final int subscribers;
  final int totalSec;
  final String? description;
  final List<Map<String, dynamic>> lessons;
  final List<Map<String, dynamic>> quizzes;
  final bool unlocked;
  final Map<String, dynamic>? completion;
  final Map<String, dynamic>? certificate;
  final String courseId;
  final Map<String, dynamic>? activeLesson;
  final String? activeVideoTitle;
  final int completedLessonCount;
  final bool isOwnCourse;
  final VoidCallback onTeacherTap;
  final VoidCallback onEvaluate;
  final dynamic l10n;

  bool _isLessonCompleted(Map<String, dynamic> lesson) {
    if (lesson['isCompleted'] == true || lesson['completed'] == true) return true;
    return ((lesson['progressPct'] as num?)?.toDouble() ?? 0) >= 90;
  }

  @override
  Widget build(BuildContext context) {
    final courseRating = (course['courseRating'] as num?)?.toDouble();
    final courseRatingCount = (course['courseRatingCount'] as num?)?.toInt() ?? 0;
    final favorites = (course['favorites'] as num?)?.toInt() ?? 0;
    final passedQuizzes = unlocked
        ? quizzes.where((q) => q['passedByMe'] == true).length
        : 0;
    final myRating = (completion?['myRating'] as num?)?.toInt();
    final active = activeLesson;
    final activeProgress =
        ((active?['progressPct'] as num?)?.toDouble() ?? 0).clamp(0.0, 100.0);
    final activeCompleted = active != null && _isLessonCompleted(active);

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        if (isOwnCourse) ...[
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _MetaTag(
                icon: Icons.verified_outlined,
                label: l10n.storeYourCourse,
                accent: true,
              ),
              _MetaTag(
                label: (course['status']?.toString() ?? 'APPROVED')
                    .replaceAll('_', ' '),
              ),
              _MetaTag(label: l10n.homeViews(views)),
              if (subscribers > 0)
                _MetaTag(label: l10n.homeSubscribers(subscribers)),
              ActionChip(
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                avatar: const Icon(Icons.video_call_outlined, size: 16),
                label: Text(
                  l10n.storeManageInStudio,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const TeacherStudioScreen(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
        ],
        Text(
          l10n.t('mobile.store.currentVideo'),
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: active != null ? AppTheme.accent.withValues(alpha: 0.45) : AppTheme.cardBorder,
            ),
          ),
          child: activeVideoTitle != null && activeVideoTitle!.isNotEmpty
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          activeCompleted
                              ? Icons.check_circle_rounded
                              : Icons.play_circle_outline_rounded,
                          color: activeCompleted ? Colors.greenAccent : AppTheme.accent,
                          size: 22,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            activeVideoTitle!,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (active != null && !activeCompleted && activeProgress > 0) ...[
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: activeProgress / 100,
                          minHeight: 5,
                          backgroundColor: AppTheme.cardBorder,
                          color: AppTheme.accent,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${activeProgress.toStringAsFixed(0)}%',
                        style: TextStyle(fontSize: 11.5, color: AppTheme.muted),
                      ),
                    ],
                    if (activeCompleted) ...[
                      const SizedBox(height: 8),
                      Text(
                        l10n.t('quiz.passed'),
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: Colors.greenAccent.withValues(alpha: 0.95),
                        ),
                      ),
                    ],
                  ],
                )
              : Text(
                  l10n.t('mobile.store.selectLessonHint'),
                  style: TextStyle(color: AppTheme.muted, height: 1.4, fontSize: 13),
                ),
        ),
        const SizedBox(height: 16),
        Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onTeacherTap,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppTheme.cardBorder),
              ),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
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
                          fontSize: 18,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          teacherName,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.star_rounded, size: 16, color: Colors.amber),
                            const SizedBox(width: 4),
                            Text(
                              rating > 0
                                  ? rating.toStringAsFixed(1)
                                  : l10n.t('rank.noRankings'),
                              style: TextStyle(fontSize: 13, color: AppTheme.muted),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Text(
                    l10n.t('mobile.reels.viewTeacher'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.accent,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded, size: 20, color: AppTheme.accent),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          l10n.t('mobile.store.courseStats'),
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _DetailStatChip(
              icon: Icons.visibility_outlined,
              label: l10n.homeViews(views),
            ),
            _DetailStatChip(
              icon: Icons.people_outline_rounded,
              label: l10n.homeSubscribers(subscribers),
            ),
            _DetailStatChip(
              icon: Icons.schedule_rounded,
              label: formatDuration(totalSec),
            ),
            if (courseRating != null && courseRatingCount > 0)
              _DetailStatChip(
                icon: Icons.star_outline_rounded,
                label:
                    '${courseRating.toStringAsFixed(1)} (${l10n.t('mobile.store.courseRatingLabel')})',
              ),
            if (favorites > 0)
              _DetailStatChip(
                icon: Icons.bookmark_outline_rounded,
                label: '$favorites',
              ),
          ],
        ),
        const SizedBox(height: 18),
        Text(
          l10n.t('mobile.store.about'),
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
        const SizedBox(height: 8),
        Text(
          description != null && description!.isNotEmpty
              ? description!
              : l10n.t('mobile.store.noDescription'),
          style: TextStyle(color: AppTheme.muted, height: 1.5, fontSize: 13.5),
        ),
        if (certificate != null && certificate!['eligibleRole'] == true)
          CourseCertificateCard(
            courseId: courseId,
            certificate: certificate!,
            courseTitle: localizedText(course, context.localeCode),
          ),
        if (unlocked) ...[
          const SizedBox(height: 20),
          _CourseProgressHeader(
            lessons: lessons,
            quizzesCount: quizzes.length,
            completedCount: completedLessonCount,
            unlocked: unlocked,
            l10n: l10n,
            compact: false,
            pendingEvaluation: completion?['pendingEvaluation'] == true && !isOwnCourse,
            myRating: myRating,
            onEvaluate: onEvaluate,
          ),
          if (quizzes.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.cardBorder),
              ),
              child: Row(
                children: [
                  const Icon(Icons.quiz_outlined, size: 18, color: AppTheme.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n.t('mobile.store.quizzesPassed', {
                        'passed': '$passedQuizzes',
                        'total': '${quizzes.length}',
                      }),
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ],
    );
  }
}

class _DetailStatChip extends StatelessWidget {
  const _DetailStatChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppTheme.accent),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
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
        icon: Icons.info_outline_rounded,
        short: l10n.t('mobile.store.tabShortDetails'),
        count: null,
      ),
      (
        icon: Icons.play_lesson_rounded,
        short: l10n.t('mobile.store.tabShortCurriculum'),
        count: lessonsCount + quizzesCount,
      ),
      (
        icon: Icons.chat_bubble_outline_rounded,
        short: l10n.t('mobile.store.tabShortQA'),
        count: null,
      ),
      (
        icon: Icons.folder_copy_outlined,
        short: l10n.t('mobile.store.tabShortFiles'),
        count: materialsCount > 0 ? materialsCount : null,
      ),
    ];

    return Container(
      height: 48,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: const Color(0xFF08081A),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final tabWidth = constraints.maxWidth / tabs.length;
          final isRtl = Directionality.of(context) == TextDirection.rtl;
          final pillStart = (isRtl ? tabs.length - 1 - selected : selected) * tabWidth + 2;
          return Stack(
            clipBehavior: Clip.none,
            children: [
              AnimatedPositioned(
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOutCubic,
                left: pillStart,
                top: 2,
                bottom: 2,
                width: tabWidth - 4,
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: AppTheme.gradient,
                      borderRadius: BorderRadius.circular(11),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primary.withValues(alpha: 0.35),
                          blurRadius: 10,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Row(
                children: List.generate(tabs.length, (i) {
                  final tab = tabs[i];
                  final active = selected == i;
                  return Expanded(
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(11),
                        onTap: () => onSelected(i),
                        child: SizedBox(
                          height: 42,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                tab.icon,
                                size: 17,
                                color: active ? Colors.white : AppTheme.muted,
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  tab.short,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                                    color: active ? Colors.white : AppTheme.muted,
                                  ),
                                ),
                              ),
                              if (tab.count != null) ...[
                                const SizedBox(width: 5),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                  decoration: BoxDecoration(
                                    color: active
                                        ? Colors.white.withValues(alpha: 0.22)
                                        : AppTheme.primary.withValues(alpha: 0.18),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    '${tab.count}',
                                    style: TextStyle(
                                      fontSize: 10,
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
                    ),
                  );
                }),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _MetaTag extends StatelessWidget {
  const _MetaTag({
    required this.label,
    this.icon,
    this.accent = false,
  });

  final String label;
  final IconData? icon;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final fg = accent ? AppTheme.accent : AppTheme.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: accent
            ? AppTheme.accent.withValues(alpha: 0.12)
            : AppTheme.card,
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
          if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: accent ? AppTheme.accent : AppTheme.foreground,
            ),
          ),
        ],
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
    this.locked = false,
    this.passed = false,
  });

  final String title;
  final int passPct;
  final int? questionCount;
  final VoidCallback onTap;
  final bool locked;
  final bool passed;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return SizedBox(
      height: 60,
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: passed
                ? Colors.greenAccent.withValues(alpha: 0.45)
                : AppTheme.accent.withValues(alpha: 0.35),
          ),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      gradient: locked ? null : AppTheme.gradient,
                      color: locked ? AppTheme.cardBorder : null,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      locked
                          ? Icons.lock_outline
                          : passed
                              ? Icons.check_circle_outline
                              : Icons.quiz_outlined,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            color: AppTheme.foreground,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          [
                            if (passed) l10n.t('quiz.passed'),
                            if (questionCount != null)
                              '${l10n.t('quiz.questions')}: $questionCount',
                            '${l10n.t('quiz.passMark')} $passPct%',
                          ].join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 10.5, color: AppTheme.muted),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    locked
                        ? Icons.lock_outline
                        : Icons.play_circle_outline_rounded,
                    size: 18,
                    color: locked ? AppTheme.muted : AppTheme.accent,
                  ),
                ],
              ),
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
    this.onComposerFocusChanged,
    this.highlightQuestionId,
    this.autoFocusAnswer = false,
  });

  final List<Map<String, dynamic>> lessons;
  final Map<String, dynamic>? activeLesson;
  final bool unlocked;
  final ValueChanged<Map<String, dynamic>> onSelectLesson;
  final String Function(Map<String, dynamic> lesson, int index) lessonTitle;
  final ValueChanged<bool>? onComposerFocusChanged;
  final String? highlightQuestionId;
  final bool autoFocusAnswer;

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
          style: TextStyle(fontSize: 12, color: AppTheme.muted),
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
        const SizedBox(height: 12),
        Expanded(
          child: ListView(
            padding: EdgeInsets.only(
              bottom: 12 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              LessonQASection(
                key: ValueKey(selectedId),
                lessonId: selectedId,
                onComposerFocusChanged: widget.onComposerFocusChanged,
                highlightQuestionId: widget.highlightQuestionId,
                autoFocusAnswer: widget.autoFocusAnswer,
              ),
            ],
          ),
        ),
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

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 12),
      itemCount: materials.length,
      itemBuilder: (context, index) {
        final m = materials[index];
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
                      final title = m['title']?.toString() ?? l10n.t('student.materials');
                      if (type?.toUpperCase() == 'PDF') {
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => CourseMaterialPdfScreen(
                              url: url,
                              title: title,
                            ),
                          ),
                        );
                        return;
                      }
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
                            style: TextStyle(fontSize: 12, color: AppTheme.muted),
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
      },
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
            style: TextStyle(color: AppTheme.muted, height: 1.4),
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
              style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }
}

/// Compact lesson list row — mirrors quiz card layout (proven to render).
class _LessonDocumentsPanel extends StatelessWidget {
  const _LessonDocumentsPanel({
    required this.materials,
    required this.onView,
    required this.onNext,
    this.embedded = false,
  });

  final List<Map<String, dynamic>> materials;
  final ValueChanged<Map<String, dynamic>> onView;
  final VoidCallback onNext;
  final bool embedded;

  String _sizeLabel(int? bytes) {
    if (bytes == null || bytes <= 0) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.accent.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                l10n.t('mobile.store.documentsStep'),
                style: const TextStyle(
                  color: AppTheme.accent,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Spacer(),
            Text(
              l10n.t('mobile.store.lessonMaterials'),
              style: TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          l10n.t('mobile.store.documentsAfterLesson'),
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        ...materials.map((m) {
            final title = m['title']?.toString() ?? l10n.t('mobile.teacher.documentFallback');
            final size = _sizeLabel((m['fileSize'] as num?)?.toInt());
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Material(
              color: AppTheme.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => onView(m),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.picture_as_pdf_rounded,
                            color: AppTheme.accent),
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
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            if (size.isNotEmpty)
                              Text(size,
                                  style: TextStyle(
                                      color: AppTheme.muted, fontSize: 12)),
                          ],
                        ),
                      ),
                      FilledButton.tonal(
                        onPressed: () => onView(m),
                        child: Text(l10n.t('mobile.store.viewDocument')),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: onNext,
          icon: const Icon(Icons.arrow_forward_rounded),
          label: Text(l10n.next),
        ),
      ],
    );

    if (embedded) {
      return ColoredBox(
        color: AppTheme.card,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
          child: content,
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: AppTheme.card,
        border: Border.all(color: AppTheme.cardBorder),
      ),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      child: content,
    );
  }
}

/// Compact lesson list row — mirrors quiz card layout (proven to render).
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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final watchPos = (lesson['watchPositionSec'] as num?)?.toInt() ?? 0;
    final inProgress = !isCompleted && (progressPct > 0 || watchPos > 0) && canWatch;
    final likes = (lesson['likes'] as num?)?.toInt() ?? 0;
    final durationLabel = duration > 0
        ? formatDuration(duration)
        : l10n.t('mobile.store.durationUnknown');

    final statusLabel = switch (true) {
      true when isCompleted => l10n.t('quiz.passed'),
      true when inProgress => l10n.t('mobile.store.continueLesson'),
      true when canWatch => l10n.t('student.start'),
      _ => l10n.t('common.locked'),
    };

    final metaParts = <String>[
      durationLabel,
      l10n.homeLikes(likes),
      statusLabel,
      if (showFreeBadge) l10n.t('common.free'),
    ];

    return SizedBox(
      height: 60,
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive
                ? AppTheme.accent.withValues(alpha: 0.55)
                : AppTheme.cardBorder,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  LessonListThumbnail(
                    lesson: lesson,
                    index: index,
                    locked: !canWatch,
                    progressPct: inProgress ? progressPct : 0,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontWeight: isActive ? FontWeight.w800 : FontWeight.w700,
                            fontSize: 13,
                            color: AppTheme.foreground,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          metaParts.join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 10.5,
                            color: AppTheme.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
