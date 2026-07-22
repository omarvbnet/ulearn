import 'package:ulearn/core/api/api_client.dart';

enum CastLessonKind { store, curriculum }

/// Fetches a signed playback URL for casting (video already has platform watermark burned in).
class CastWatermarkedVideo {
  CastWatermarkedVideo._();

  static Future<String?> fetchUrl({
    required ApiClient api,
    required CastLessonKind kind,
    required String lessonId,
    String? contentId,
  }) async {
    try {
      final path = kind == CastLessonKind.store
          ? '/api/store/lessons/$lessonId/watermarked-url'
          : '/api/lessons/$lessonId/watermarked-url';
      final data = await api.post(
        path,
        kind == CastLessonKind.curriculum && contentId != null
            ? {'contentId': contentId}
            : {},
      );
      final url = data['url']?.toString();
      if (url == null || url.isEmpty) return null;
      return ApiClient.absoluteUrl(url);
    } catch (_) {
      return null;
    }
  }
}
