import 'package:ulearn/core/api/api_client.dart';

/// Re-fetch a fresh R2 signed playback URL after a player open failure.
///
/// Signed URLs expire (~6h). Clients must never HEAD them (403); refresh + GET
/// Range (fvp) or GET download is the recovery path.
class VideoUrlRefresh {
  VideoUrlRefresh._();

  /// Short / reel clip by id — scans a fresh feed page for the matching item.
  static Future<String?> shortVideo(ApiClient api, String videoId) async {
    final id = videoId.trim();
    if (id.isEmpty) return null;
    try {
      final data =
          await api.get('/api/store/short-videos?limit=24&refresh=true');
      final videos = (data['videos'] as List?) ?? const [];
      for (final raw in videos) {
        if (raw is! Map) continue;
        if (raw['id']?.toString() != id) continue;
        final url = raw['fileUrl']?.toString();
        if (url != null && url.isNotEmpty) return url;
      }
    } catch (_) {}
    return null;
  }

  /// Store-course lesson — reloads course detail and picks the lesson row.
  static Future<String?> storeLesson(
    ApiClient api, {
    required String courseId,
    required String lessonId,
  }) async {
    final cId = courseId.trim();
    final lId = lessonId.trim();
    if (cId.isEmpty || lId.isEmpty) return null;
    try {
      final data = await api.get('/api/store/courses/$cId');
      final course = data['course'];
      final lessons = (course is Map ? course['lessons'] as List? : null) ??
          (data['lessons'] as List?) ??
          const [];
      for (final raw in lessons) {
        if (raw is! Map) continue;
        if (raw['id']?.toString() != lId) continue;
        final url = raw['fileUrl']?.toString();
        if (url != null && url.isNotEmpty) return url;
      }
    } catch (_) {}
    return null;
  }

  /// Curriculum lesson video content.
  static Future<String?> curriculumLesson(ApiClient api, String lessonId) async {
    final id = lessonId.trim();
    if (id.isEmpty) return null;
    try {
      final data = await api.get('/api/lessons/$id');
      final lesson = data['lesson'];
      if (lesson is! Map) return null;
      final contents = (lesson['contents'] as List?) ?? const [];
      for (final raw in contents) {
        if (raw is! Map) continue;
        if (raw['type']?.toString() != 'VIDEO') continue;
        final url = raw['fileUrl']?.toString();
        if (url != null && url.isNotEmpty) return url;
      }
    } catch (_) {}
    return null;
  }
}
