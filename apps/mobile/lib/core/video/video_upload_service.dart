import 'dart:io';

import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/video/video_process_service.dart';

typedef UploadProgressCallback = void Function(int sent, int total);

class VideoUploadResult {
  const VideoUploadResult({
    required this.videoId,
    required this.objectKey,
    required this.fileSize,
    this.durationSec,
    this.width,
    this.height,
  });

  final String videoId;
  final String objectKey;
  final int fileSize;
  final int? durationSec;
  final int? width;
  final int? height;
}

/// Direct-to-R2 upload: signed URL from API, bytes never pass through Next.js.
class VideoUploadService {
  VideoUploadService(this._api);

  final ApiClient _api;

  static String contentTypeFor(File file) {
    final name = file.path.toLowerCase();
    if (name.endsWith('.mov')) return 'video/quicktime';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.m4v')) return 'video/x-m4v';
    if (name.endsWith('.mkv')) return 'video/x-matroska';
    return 'video/mp4';
  }

  static String filenameFor(File file) {
    final name = file.path.split(Platform.pathSeparator).last;
    if (name.contains('.')) return name;
    return '$name.mp4';
  }

  Future<VideoUploadResult> uploadCourseVideo({
    required File file,
    String? courseId,
    required String scope,
    int? durationSec,
    int? width,
    int? height,
    String? courseLessonId,
    bool watermarkApplied = false,
    UploadProgressCallback? onProgress,
    void Function(String phase)? onPhase,
  }) async {
    final size = await file.length();
    final contentType = contentTypeFor(file);
    final filename = filenameFor(file);

    onPhase?.call('presign');
    final session = await _api.post('/api/videos/upload-url', {
      if (courseId != null) 'courseId': courseId,
      'scope': scope,
      'filename': filename,
      'contentType': contentType,
      'size': size,
    });

    final videoId = session['videoId']?.toString();
    final objectKey = session['objectKey']?.toString();
    final uploadUrl = session['uploadUrl']?.toString();
    if (videoId == null || objectKey == null || uploadUrl == null) {
      throw Exception('Invalid upload session');
    }

    onPhase?.call('uploading');
    await _api.putFile(
      uploadUrl,
      file,
      contentType,
      onProgress: onProgress,
    );

    await _api.post('/api/videos/complete', {
      'videoId': videoId,
      'size': size,
      if (durationSec != null) 'durationSec': durationSec,
      if (width != null) 'width': width,
      if (height != null) 'height': height,
      'watermarkApplied': watermarkApplied,
      if (courseLessonId != null) 'courseLessonId': courseLessonId,
    });

    // Do NOT clear compressor cache here — auto-generated covers live under
    // video_compress/ until the caller finishes uploading the thumbnail.

    return VideoUploadResult(
      videoId: videoId,
      objectKey: objectKey,
      fileSize: size,
      durationSec: durationSec,
      width: width,
      height: height,
    );
  }

  Future<VideoWatermarkSettings> fetchWatermarkConfig({
    String? courseName,
    String? instructorName,
  }) async {
    final data = await _api.get('/api/videos/watermark-config');
    final settings = VideoWatermarkSettings.fromApi(data);
    return VideoWatermarkSettings(
      brandText: settings.brandText,
      opacity: settings.opacity,
      fontSize: settings.fontSize,
      position: settings.position,
      includeCourseName: settings.includeCourseName,
      includeInstructorName: settings.includeInstructorName,
      courseName: courseName,
      instructorName: instructorName,
    );
  }
}
