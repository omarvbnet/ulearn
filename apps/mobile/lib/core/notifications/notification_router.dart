import 'package:flutter/material.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/ads/ads_offers_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

/// Routes notification payloads (push + in-app list) to the correct screen.
///
/// Supported `type` values (also accepts aliases via `screen`):
/// - admin / ads / advertisement / offer → [AdsOffersScreen]
/// - comment → reel + comments sheet (reply)
/// - reel / like / save → reel video
/// - question / answer → course video + Q&A (question/answer ids)
/// - course / subscription / lesson → course (optional lesson)
class NotificationRouter {
  static String? _str(Map<String, dynamic> data, String key) {
    final v = data[key];
    if (v == null) return null;
    final s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  static void open(BuildContext context, Map<String, dynamic> data) {
    final type =
        (_str(data, 'type') ?? _str(data, 'screen') ?? '').toLowerCase();
    final courseId = _str(data, 'courseId');
    final lessonId = _str(data, 'lessonId');
    final questionId = _str(data, 'questionId');
    final answerId = _str(data, 'answerId');
    final shortVideoId = _str(data, 'shortVideoId') ?? _str(data, 'videoId');
    final commentId = _str(data, 'commentId');
    final adId = _str(data, 'adId');

    // ── Admin advertisements / offers ─────────────────────────────
    if (_isAdsType(type)) {
      _openAds(context, adId);
      return;
    }

    // ── Reel comment → open video + comments (reply) ──────────────
    if (type == 'comment' || type == 'comments') {
      _openReel(
        context,
        shortVideoId: shortVideoId,
        openComments: true,
        highlightCommentId: commentId,
      );
      return;
    }

    // ── Reel like / save / generic reel ───────────────────────────
    if (type == 'reel' ||
        type == 'reels' ||
        type == 'like' ||
        type == 'save' ||
        type == 'favorite') {
      if (courseId != null && shortVideoId == null) {
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

    // ── Lesson Q&A: question / answer ─────────────────────────────
    if (type == 'question' || type == 'answer' || type == 'qa') {
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

    // ── Subscription (teacher notified of student purchase) ───────
    if (type == 'subscription' || type == 'purchase' || type == 'subscriber') {
      if (courseId != null) {
        _openCourse(context, courseId: courseId, lessonId: lessonId);
        return;
      }
    }

    // ── Course / lesson update / course like ──────────────────────
    if (type == 'course' ||
        type == 'lesson' ||
        type == 'video' ||
        (courseId != null)) {
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

    // Fallback: ads / offers board
    _openAds(context, adId);
  }

  static bool _isAdsType(String type) =>
      type == 'admin' ||
      type == 'ads' ||
      type == 'advertisement' ||
      type == 'advertisements' ||
      type == 'offer' ||
      type == 'offers';

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
