import 'package:flutter/material.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/ads/ads_offers_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

/// Routes notification payloads (push + in-app list) to the correct screen.
///
/// Routing priority:
/// 1. Explicit types (comment → reel+comments, question/answer → course Q&A, …)
/// 2. Payload IDs (shortVideoId / courseId / adId) when type is missing/ambiguous
/// 3. Ads board only for explicit admin/ads types — never as a blind default
class NotificationRouter {
  static String? _str(Map<String, dynamic> data, String key) {
    final v = data[key];
    if (v == null) return null;
    final s = v.toString().trim();
    return s.isEmpty || s == 'null' || s == 'undefined' ? null : s;
  }

  static void open(BuildContext context, Map<String, dynamic> raw) {
    // Normalize FCM / JSON maps (values may be non-String).
    final data = <String, dynamic>{
      for (final e in raw.entries) e.key.toString(): e.value,
    };

    final typeRaw = (_str(data, 'type') ?? '').toLowerCase();
    final screenRaw = (_str(data, 'screen') ?? '').toLowerCase();
    // Prefer explicit type; use screen only as a hint when type is empty.
    final type = typeRaw.isNotEmpty ? typeRaw : screenRaw;

    final courseId = _str(data, 'courseId');
    final lessonId = _str(data, 'lessonId');
    final questionId = _str(data, 'questionId');
    final answerId = _str(data, 'answerId');
    final shortVideoId = _str(data, 'shortVideoId') ?? _str(data, 'videoId');
    final commentId = _str(data, 'commentId');
    final adId = _str(data, 'adId');

    // ── Reel comments / reply ─────────────────────────────────────
    if (_isCommentType(type) ||
        (commentId != null && shortVideoId != null)) {
      _openReel(
        context,
        shortVideoId: shortVideoId,
        openComments: true,
        highlightCommentId: commentId,
      );
      return;
    }

    // ── Lesson Q&A ────────────────────────────────────────────────
    if (_isQaType(type) || questionId != null || answerId != null) {
      if (courseId != null) {
        _openCourse(
          context,
          courseId: courseId,
          lessonId: lessonId,
          questionId: questionId,
          answerId: answerId,
          openQa: true,
        );
        return;
      }
    }

    // ── Subscription / course purchase unlock ─────────────────────
    if (_isSubscriptionType(type) && courseId != null) {
      _openCourse(context, courseId: courseId, lessonId: lessonId);
      return;
    }

    // ── Course / lesson (explicit or ID present) ──────────────────
    if (_isCourseType(type) ||
        (courseId != null && shortVideoId == null && !_isReelEngagement(type))) {
      if (courseId != null) {
        _openCourse(
          context,
          courseId: courseId,
          lessonId: lessonId,
          questionId: questionId,
          answerId: answerId,
          openQa: questionId != null || answerId != null,
        );
        return;
      }
    }

    // ── Reel like / save / generic reel ───────────────────────────
    if (_isReelEngagement(type) || shortVideoId != null) {
      // Course-video like: type=like + courseId, no shortVideoId
      if (courseId != null && shortVideoId == null && type == 'like') {
        _openCourse(context, courseId: courseId, lessonId: lessonId);
        return;
      }
      _openReel(
        context,
        shortVideoId: shortVideoId,
        openComments: false,
      );
      return;
    }

    // ── Ads / offers (explicit only) ──────────────────────────────
    if (_isAdsType(type) || adId != null) {
      _openAds(context, adId);
      return;
    }

    // Unknown / empty payload — do not dump users on the ads board.
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      const SnackBar(content: Text('Notification opened')),
    );
  }

  static bool _isAdsType(String type) =>
      type == 'admin' ||
      type == 'ads' ||
      type == 'advertisement' ||
      type == 'advertisements' ||
      type == 'offer' ||
      type == 'offers';

  static bool _isCommentType(String type) =>
      type == 'comment' || type == 'comments';

  static bool _isQaType(String type) =>
      type == 'question' || type == 'answer' || type == 'qa';

  static bool _isSubscriptionType(String type) =>
      type == 'subscription' || type == 'purchase' || type == 'subscriber';

  static bool _isCourseType(String type) =>
      type == 'course' || type == 'lesson' || type == 'video';

  static bool _isReelEngagement(String type) =>
      type == 'reel' ||
      type == 'reels' ||
      type == 'like' ||
      type == 'save' ||
      type == 'favorite';

  static void _openAds(BuildContext context, String? adId) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AdsOffersScreen(highlightAdId: adId),
      ),
    );
  }

  static void _openReel(
    BuildContext context, {
    String? shortVideoId,
    required bool openComments,
    String? highlightCommentId,
  }) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: GlassAppBar(title: const Text('Reels')),
          body: ReelsScreen(
            initialVideoId: shortVideoId,
            openCommentsOnStart: openComments,
            highlightCommentId: highlightCommentId,
          ),
        ),
      ),
    );
  }

  static void _openCourse(
    BuildContext context, {
    required String courseId,
    String? lessonId,
    String? questionId,
    String? answerId,
    bool openQa = false,
  }) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CourseDetailScreen(
          courseId: courseId,
          initialLessonId: lessonId,
          initialQuestionId: questionId,
          initialAnswerId: answerId,
          openQa: openQa,
        ),
      ),
    );
  }
}
