import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/store/teacher_course_wizard_screen.dart';
import 'package:ulearn/features/store/teacher_course_manage_screen.dart';
import 'package:ulearn/features/store/teacher_quiz_tab.dart';
import 'package:ulearn/features/store/widgets/free_minute_picker.dart';
import 'package:ulearn/core/video/video_process_service.dart';
import 'package:ulearn/core/video/video_upload_service.dart';

const _compressPrefKey = 'teacher_compress_before_upload';

enum StudioUploadPhase {
  idle,
  preparing,
  compressing,
  uploadingVideo,
  uploadingCover,
  uploadingPdf,
  saving,
}

class StudioUploadProgress {
  const StudioUploadProgress({
    required this.phase,
    required this.overallPercent,
    this.byteDetail,
  });

  final StudioUploadPhase phase;
  final int overallPercent;
  final String? byteDetail;
}

class _UploadSegment {
  const _UploadSegment(this.start, this.end);

  final int start;
  final int end;

  int atRatio(double ratio) =>
      (start + ratio.clamp(0.0, 1.0) * (end - start)).round().clamp(start, end);
}

class _UploadPlan {
  _UploadPlan({required bool compress, required bool includePdf}) {
    var cursor = 1;
    preparing = _UploadSegment(cursor, cursor + 2);
    cursor = preparing.end;

    // Compress/watermark is usually the longest phase — give it real bar weight
    // so overall % doesn't look stuck while FFmpeg runs.
    if (compress) {
      compressing = _UploadSegment(cursor, cursor + 40);
      cursor = compressing.end;
    } else {
      compressing = _UploadSegment(cursor, cursor);
    }

    videoPresign = _UploadSegment(cursor, cursor + 2);
    cursor = videoPresign.end;

    final videoWeight = includePdf ? 38 : 44;
    videoUpload = _UploadSegment(cursor, cursor + videoWeight);
    cursor = videoUpload.end;

    thumbnail = _UploadSegment(cursor, cursor + 2);
    cursor = thumbnail.end;

    coverUpload = _UploadSegment(cursor, cursor + 4);
    cursor = coverUpload.end;

    if (includePdf) {
      pdfUpload = _UploadSegment(cursor, cursor + 5);
      cursor = pdfUpload.end;
    } else {
      pdfUpload = _UploadSegment(cursor, cursor);
    }

    saving = _UploadSegment(cursor, 100);
  }

  late final _UploadSegment preparing;
  late final _UploadSegment compressing;
  late final _UploadSegment videoPresign;
  late final _UploadSegment videoUpload;
  late final _UploadSegment thumbnail;
  late final _UploadSegment coverUpload;
  late final _UploadSegment pdfUpload;
  late final _UploadSegment saving;
}

/// Teacher mobile studio: upload course videos and short videos.
class TeacherStudioScreen extends StatefulWidget {
  const TeacherStudioScreen({super.key});

  @override
  State<TeacherStudioScreen> createState() => _TeacherStudioScreenState();
}

class _TeacherStudioScreenState extends State<TeacherStudioScreen> {
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _shorts = [];
  String? _courseId;
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  bool _loading = true;
  bool _uploading = false;
  StudioUploadProgress? _uploadProgress;
  Timer? _progressUiTimer;
  bool _compressBeforeUpload = true;
  /// paid | fullFree | timedFree
  String _accessMode = 'paid';
  int _freePreviewSec = 120;

  File? _pendingVideo;
  File? _pendingCover;
  File? _pendingPdf;
  int? _pendingDurationSec;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
    _load();
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(
      () => _compressBeforeUpload = prefs.getBool(_compressPrefKey) ?? true,
    );
  }

  Future<void> _setCompressBeforeUpload(bool value) async {
    setState(() => _compressBeforeUpload = value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_compressPrefKey, value);
  }

  @override
  void dispose() {
    _progressUiTimer?.cancel();
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  void _clearCover() => setState(() => _pendingCover = null);

  void _clearPendingMedia() {
    setState(() {
      _pendingVideo = null;
      _pendingCover = null;
      _pendingPdf = null;
      _pendingDurationSec = null;
      _accessMode = 'paid';
      _freePreviewSec = 120;
    });
  }

  void _setOverall(
    int percent,
    StudioUploadPhase phase, {
    String? byteDetail,
    bool force = false,
  }) {
    if (!mounted) return;
    final clamped = percent.clamp(1, 100);
    _uploadProgress = StudioUploadProgress(
      phase: phase,
      overallPercent: clamped,
      byteDetail: byteDetail,
    );

    // Timer (not post-frame) so the bar updates even when the UI is idle —
    // addPostFrameCallback only runs after scroll/input schedules a frame.
    if (force) {
      _progressUiTimer?.cancel();
      _progressUiTimer = null;
      setState(() {});
      return;
    }
    if (_progressUiTimer?.isActive ?? false) return;
    _progressUiTimer = Timer(const Duration(milliseconds: 80), () {
      _progressUiTimer = null;
      if (mounted) setState(() {});
    });
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  void _setByteProgress(
    _UploadSegment segment,
    StudioUploadPhase phase,
    int sent,
    int total,
  ) {
    if (total <= 0) return;
    final detail = '${_formatBytes(sent)} / ${_formatBytes(total)}';
    _setOverall(segment.atRatio(sent / total), phase, byteDetail: detail);
  }

  String _phaseLabel(dynamic l10n, StudioUploadPhase phase) {
    return switch (phase) {
      StudioUploadPhase.preparing => l10n.t('mobile.studio.uploadPreparing'),
      StudioUploadPhase.compressing => l10n.t(
        'mobile.studio.uploadCompressing',
      ),
      StudioUploadPhase.uploadingVideo => l10n.t(
        'mobile.studio.uploadUploadingVideo',
      ),
      StudioUploadPhase.uploadingCover => l10n.t(
        'mobile.studio.uploadUploadingCover',
      ),
      StudioUploadPhase.uploadingPdf => l10n.t(
        'mobile.studio.uploadUploadingPdf',
      ),
      StudioUploadPhase.saving => l10n.t('mobile.studio.uploadSaving'),
      StudioUploadPhase.idle => '',
    };
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        context.read<ApiClient>().get('/api/teacher/courses'),
        context.read<ApiClient>().get('/api/teacher/short-videos'),
      ]);
      if (!mounted) return;
      setState(() {
        _courses = ((results[0]['courses'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _shorts = ((results[1]['videos'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _courseId ??= _courses.isNotEmpty
            ? _courses.first['id']?.toString()
            : null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _selectedCourseTitle() {
    if (_courseId == null) return null;
    for (final c in _courses) {
      if (c['id']?.toString() == _courseId) {
        return c['titleAr']?.toString() ??
            c['titleEn']?.toString() ??
            c['title']?.toString();
      }
    }
    return null;
  }

  Future<File?> _processVideoForUpload(_UploadPlan plan, {String? courseName}) async {
    final video = _pendingVideo;
    if (video == null) return null;

    final uploadService = VideoUploadService(context.read<ApiClient>());
    final wm = await uploadService.fetchWatermarkConfig(courseName: courseName);
    final sourceBytes = await video.length();

    _setOverall(
      plan.compressing.start,
      StudioUploadPhase.compressing,
      byteDetail: context.l10n.t('mobile.studio.convertingIphone', {
        'size': VideoProcessService.formatBytes(sourceBytes),
      }),
      force: true,
    );
    final result = await VideoProcessService.processForUpload(
      source: video,
      watermark: wm,
      onProgress: (p) {
        if (!mounted) return;
        _setOverall(
          plan.compressing.atRatio(p),
          StudioUploadPhase.compressing,
          byteDetail: context.l10n.t('mobile.teacher.convertingVideo', {
            'size': VideoProcessService.formatBytes(sourceBytes),
            'percent': '${(p * 100).round()}',
          }),
        );
      },
    );
    if (mounted) {
      _setOverall(
        plan.compressing.end,
        StudioUploadPhase.compressing,
        byteDetail:
            '${VideoProcessService.formatBytes(result.sourceBytes)} → ${VideoProcessService.formatBytes(result.outputBytes)}',
        force: true,
      );
    }
    return result.file;
  }

  Future<Map<String, String>?> _uploadFile(
    File file,
    String filename,
    String contentType, {
    required String category,
    required String folder,
    required StudioUploadPhase progressPhase,
    required _UploadSegment presignSegment,
    required _UploadSegment uploadSegment,
  }) async {
    final api = context.read<ApiClient>();
    final size = await file.length();

    _setOverall(presignSegment.start, progressPhase, force: true);
    final presign = await api.post('/api/admin/uploads', {
      'filename': filename,
      'contentType': contentType,
      'size': size,
      'category': category,
      'folder': folder,
    });
    _setOverall(presignSegment.end, progressPhase, force: true);

    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) return null;

    await api.putFile(
      uploadUrl,
      file,
      contentType,
      onProgress: (sent, total) {
        if (!mounted) return;
        _setByteProgress(uploadSegment, progressPhase, sent, total);
      },
    );
    _setOverall(uploadSegment.end, progressPhase, force: true);
    return {'key': key, 'url': publicUrl ?? uploadUrl};
  }

  Future<VideoUploadResult?> _uploadVideoToR2({
    required File file,
    required String scope,
    String? courseId,
    required _UploadPlan plan,
  }) {
    final uploadService = VideoUploadService(context.read<ApiClient>());
    _setOverall(
      plan.videoPresign.start,
      StudioUploadPhase.uploadingVideo,
      force: true,
    );
    return uploadService.uploadCourseVideo(
      file: file,
      courseId: courseId,
      scope: scope,
      durationSec: _pendingDurationSec,
      watermarkApplied: _compressBeforeUpload,
      onPhase: (phase) {
        if (!mounted) return;
        if (phase == 'presign') {
          _setOverall(
            plan.videoPresign.end,
            StudioUploadPhase.uploadingVideo,
            force: true,
          );
        }
      },
      onProgress: (sent, total) {
        if (!mounted) return;
        _setByteProgress(
          plan.videoUpload,
          StudioUploadPhase.uploadingVideo,
          sent,
          total,
        );
      },
    );
  }

  Future<Map<String, String>?> _uploadPdfFile(File file, _UploadPlan plan) {
    final name = file.path.split(Platform.pathSeparator).last;
    return _uploadFile(
      file,
      name.toLowerCase().endsWith('.pdf') ? name : '$name.pdf',
      'application/pdf',
      category: 'document',
      folder: 'teacher-course-pdfs',
      progressPhase: StudioUploadPhase.uploadingPdf,
      presignSegment: _UploadSegment(
        plan.pdfUpload.start,
        plan.pdfUpload.start + 1,
      ),
      uploadSegment: plan.pdfUpload,
    );
  }

  Future<void> _pickPdf() async {
    final pick = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (pick == null || pick.files.isEmpty) return;
    final file = pick.files.first;
    if (file.path != null && mounted)
      setState(() => _pendingPdf = File(file.path!));
  }

  Future<Map<String, String>?> _uploadCoverFile(
    File file,
    String folder,
    _UploadPlan plan,
  ) {
    final ext = file.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    return _uploadFile(
      file,
      'cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
      ext == 'png' ? 'image/png' : 'image/jpeg',
      category: 'image',
      folder: folder,
      progressPhase: StudioUploadPhase.uploadingCover,
      presignSegment: _UploadSegment(
        plan.coverUpload.start,
        plan.coverUpload.start + 1,
      ),
      uploadSegment: plan.coverUpload,
    );
  }

  Future<void> _selectVideo() async {
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty) return;

    File? source;
    final file = pick.files.first;
    if (file.path != null) {
      source = File(file.path!);
    } else if (file.bytes != null) {
      source = File(
        '${Directory.systemTemp.path}/ulearn_upload_${DateTime.now().millisecondsSinceEpoch}.mp4',
      );
      await source.writeAsBytes(file.bytes!);
    }
    if (source == null) return;

    final duration = await VideoCoverHelper.videoDurationSec(source.path);
    if (!mounted) return;
    final sizeLabel = VideoProcessService.formatBytes(await source.length());
    final isMov = source.path.toLowerCase().endsWith('.mov');
    setState(() {
      _pendingVideo = source;
      _pendingCover = null;
      _pendingDurationSec = duration;
    });
    if (isMov && _compressBeforeUpload) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            context.l10n.t('mobile.studio.compressOnHint', {'size': sizeLabel}),
          ),
          duration: const Duration(seconds: 4),
        ),
      );
    } else if (isMov && !_compressBeforeUpload) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            context.l10n.t('mobile.studio.compressOffHint', {'size': sizeLabel}),
          ),
          duration: const Duration(seconds: 4),
        ),
      );
    }
  }

  Future<void> _pickCoverImage() async {
    if (_pendingVideo == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioPickVideoFirst)),
      );
      return;
    }
    final cover = await VideoCoverHelper.pickCoverImage();
    if (cover != null && mounted) setState(() => _pendingCover = cover);
  }

  Future<void> _autoCoverFromVideo() async {
    if (_pendingVideo == null) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.t('mobile.studio.fromVideo'))),
    );
    final cover = await VideoCoverHelper.thumbnailFromVideo(
      _pendingVideo!.path,
    );
    if (!mounted) return;
    if (cover == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.l10n.t('mobile.studio.coverFromVideoFailed')),
        ),
      );
      return;
    }
    setState(() => _pendingCover = cover);
  }

  Future<File?> _prepareVideoForUpload(_UploadPlan plan) async {
    var video = _pendingVideo;
    if (video == null) {
      await _selectVideo();
      video = _pendingVideo;
    }
    if (video == null) return null;
    // Compress / watermark only when the teacher turns the toggle on.
    if (!_compressBeforeUpload) return video;
    return _processVideoForUpload(plan, courseName: _selectedCourseTitle());
  }

  Future<void> _uploadCourseVideo() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_courseId == null || _titleCtrl.text.trim().isEmpty) return;
    if (_pendingVideo == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioPickVideoFirst)),
      );
      return;
    }
    if (_pendingCover == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.studio.coverRequired'))),
      );
      return;
    }

    final plan = _UploadPlan(
      compress: _compressBeforeUpload,
      includePdf: _pendingPdf != null,
    );

    setState(() {
      _uploading = true;
      _uploadProgress = StudioUploadProgress(
        phase: StudioUploadPhase.preparing,
        overallPercent: 1,
      );
    });
    try {
      _setOverall(
        plan.preparing.end,
        StudioUploadPhase.preparing,
        byteDetail: null,
        force: true,
      );
      final videoFile = await _prepareVideoForUpload(plan);
      if (videoFile == null) return;

      final uploaded = await _uploadVideoToR2(
        file: videoFile,
        courseId: _courseId!,
        scope: 'STORE_COURSE',
        plan: plan,
      );
      if (uploaded == null) throw Exception('Upload failed');

      // Cover is required and already chosen — never auto-extract (that hangs on large MOV).
      _setOverall(
        plan.coverUpload.start,
        StudioUploadPhase.uploadingCover,
        byteDetail: context.l10n.t('mobile.studio.uploadingCoverBusy'),
        force: true,
      );
      final cover = await _uploadCoverFile(_pendingCover!, 'teacher-covers', plan);
      if (cover == null) throw Exception('Cover upload failed');

      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'fileKey': uploaded.objectKey,
        'videoAssetId': uploaded.videoId,
        'thumbnailKey': cover['key'],
        'thumbnailUrl': cover['url'],
        if (_pendingDurationSec != null) 'durationSec': _pendingDurationSec,
        'isFreePreview': _accessMode == 'fullFree',
        if (_accessMode == 'timedFree') 'freePreviewSec': _freePreviewSec,
        if (_accessMode != 'timedFree') 'freePreviewSec': null,
      };

      if (_pendingPdf != null) {
        final pdf = await _uploadPdfFile(_pendingPdf!, plan);
        if (pdf != null) {
          payload['pdfFileKey'] = pdf['key'];
          payload['pdfFileUrl'] = pdf['url'];
          payload['pdfMimeType'] = 'application/pdf';
          payload['pdfTitle'] = '${_titleCtrl.text.trim()} — PDF';
        }
      }

      _setOverall(
        plan.saving.start,
        StudioUploadPhase.saving,
        byteDetail: null,
        force: true,
      );
      await context.read<ApiClient>().post(
        '/api/teacher/courses/$_courseId/lessons',
        payload,
      );
      _setOverall(100, StudioUploadPhase.saving, byteDetail: null, force: true);
      if (!mounted) return;
      _titleCtrl.clear();
      _clearPendingMedia();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.studioVideoUploaded)));
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = null;
          _progressUiTimer?.cancel();
          _progressUiTimer = null;
        });
      }
    }
  }

  Future<void> _uploadShort() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_titleCtrl.text.trim().isEmpty) return;
    if (_pendingVideo == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioPickVideoFirst)),
      );
      return;
    }
    if (_pendingCover == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.studio.coverRequired'))),
      );
      return;
    }

    final plan = _UploadPlan(
      compress: _compressBeforeUpload,
      includePdf: false,
    );

    setState(() {
      _uploading = true;
      _uploadProgress = StudioUploadProgress(
        phase: StudioUploadPhase.preparing,
        overallPercent: 1,
      );
    });
    try {
      _setOverall(
        plan.preparing.end,
        StudioUploadPhase.preparing,
        byteDetail: null,
        force: true,
      );
      final videoFile = await _prepareVideoForUpload(plan);
      if (videoFile == null) return;

      final uploaded = await _uploadVideoToR2(
        file: videoFile,
        scope: 'SHORT_VIDEO',
        plan: plan,
      );
      if (uploaded == null) throw Exception('Upload failed');

      _setOverall(
        plan.coverUpload.start,
        StudioUploadPhase.uploadingCover,
        byteDetail: context.l10n.t('mobile.studio.uploadingCoverBusy'),
        force: true,
      );
      final cover = await _uploadCoverFile(
        _pendingCover!,
        'teacher-shorts-covers',
        plan,
      );
      if (cover == null) throw Exception('Cover upload failed');

      _setOverall(
        plan.saving.start,
        StudioUploadPhase.saving,
        byteDetail: null,
        force: true,
      );
      await context.read<ApiClient>().post('/api/teacher/short-videos', {
        'title': _titleCtrl.text.trim(),
        if (_descCtrl.text.trim().isNotEmpty)
          'description': _descCtrl.text.trim(),
        'fileKey': uploaded.objectKey,
        'thumbnailUrl': cover['url'],
        if (_pendingDurationSec != null) 'durationSec': _pendingDurationSec,
      });
      _setOverall(100, StudioUploadPhase.saving, byteDetail: null, force: true);
      if (!mounted) return;
      _titleCtrl.clear();
      _descCtrl.clear();
      _clearPendingMedia();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioShortSubmitted)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = null;
          _progressUiTimer?.cancel();
          _progressUiTimer = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: DefaultTabController(
      length: 3,
      child: Scaffold(
        body: NestedScrollView(
          headerSliverBuilder: (context, innerBoxIsScrolled) => [
            SliverAppBar(
              expandedHeight: 120,
              pinned: true,
              stretch: true,
              title: Text(l10n.profileTeacherStudio),
              actions: [
                IconButton(
                  tooltip: l10n.t('mobile.teacher.manageCourse'),
                  icon: const Icon(Icons.tune_rounded),
                  onPressed: _courseId == null
                      ? null
                      : () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => TeacherCourseManageScreen(
                                courseId: _courseId!,
                              ),
                            ),
                          );
                          if (mounted) _load();
                        },
                ),
                IconButton(
                  tooltip: l10n.t('mobile.teacher.newCourse'),
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: () async {
                    final created = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) => const TeacherCourseWizardScreen(),
                      ),
                    );
                    if (created == true && mounted) _load();
                  },
                ),
                const SizedBox(width: 4),
              ],
              flexibleSpace: FlexibleSpaceBar(
                background: Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.primary.withValues(alpha: 0.35),
                        AppTheme.background,
                      ],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                ),
              ),
              bottom: TabBar(
                indicatorColor: AppTheme.accent,
                labelColor: AppTheme.accent,
                unselectedLabelColor: AppTheme.muted,
                tabs: [
                  Tab(
                    icon: const Icon(Icons.video_library_outlined, size: 20),
                    text: l10n.t('student.videos'),
                  ),
                  Tab(
                    icon: const Icon(Icons.quiz_outlined, size: 20),
                    text: l10n.t('student.quizzes'),
                  ),
                  Tab(
                    icon: const Icon(Icons.movie_filter_outlined, size: 20),
                    text: l10n.reelsTitle,
                  ),
                ],
              ),
            ),
          ],
          body: _loading
              ? const Center(
                  child: CircularProgressIndicator(color: AppTheme.accent),
                )
              : TabBarView(
                  children: [
                    _UploadTab(
                      titleCtrl: _titleCtrl,
                      descCtrl: null,
                      uploading: _uploading,
                      uploadProgress: _uploadProgress,
                      phaseLabel: _uploadProgress != null
                          ? _phaseLabel(l10n, _uploadProgress!.phase)
                          : null,
                      courses: _courses,
                      courseId: _courseId,
                      onCourse: (id) => setState(() => _courseId = id),
                      onSelectVideo: _selectVideo,
                      onPickCover: _pickCoverImage,
                      onAutoCover: _autoCoverFromVideo,
                      onClearCover: _clearCover,
                      onClearMedia: _clearPendingMedia,
                      pendingVideo: _pendingVideo,
                      pendingCover: _pendingCover,
                      pendingPdf: _pendingPdf,
                      onPickPdf: _pickPdf,
                      onClearPdf: () => setState(() => _pendingPdf = null),
                      pendingDurationSec: _pendingDurationSec,
                      onUpload: _uploadCourseVideo,
                      compressBeforeUpload: _compressBeforeUpload,
                      onCompressChanged: _setCompressBeforeUpload,
                      accessMode: _accessMode,
                      onAccessMode: (m) => setState(() => _accessMode = m),
                      freePreviewSec: _freePreviewSec,
                      onFreePreviewSec: (s) => setState(() => _freePreviewSec = s),
                    ),
                    TeacherQuizTab(
                      courses: _courses,
                      courseId: _courseId,
                      onCourseChanged: (id) => setState(() => _courseId = id),
                    ),
                    _UploadTab(
                      titleCtrl: _titleCtrl,
                      descCtrl: _descCtrl,
                      uploading: _uploading,
                      uploadProgress: _uploadProgress,
                      phaseLabel: _uploadProgress != null
                          ? _phaseLabel(l10n, _uploadProgress!.phase)
                          : null,
                      courses: const [],
                      courseId: null,
                      onCourse: (_) {},
                      onSelectVideo: _selectVideo,
                      onPickCover: _pickCoverImage,
                      onAutoCover: _autoCoverFromVideo,
                      onClearCover: _clearCover,
                      onClearMedia: _clearPendingMedia,
                      pendingVideo: _pendingVideo,
                      pendingCover: _pendingCover,
                      pendingDurationSec: _pendingDurationSec,
                      onUpload: _uploadShort,
                      isShort: true,
                      shorts: _shorts,
                      compressBeforeUpload: _compressBeforeUpload,
                      onCompressChanged: _setCompressBeforeUpload,
                    ),
                  ],
                ),
        ),
      ),
      ),
    );
  }
}

class _UploadTab extends StatelessWidget {
  const _UploadTab({
    required this.titleCtrl,
    required this.descCtrl,
    required this.uploading,
    required this.uploadProgress,
    required this.phaseLabel,
    required this.courses,
    required this.courseId,
    required this.onCourse,
    required this.onSelectVideo,
    required this.onPickCover,
    required this.onAutoCover,
    required this.onClearCover,
    required this.onClearMedia,
    required this.pendingVideo,
    required this.pendingCover,
    this.pendingPdf,
    this.onPickPdf,
    this.onClearPdf,
    required this.pendingDurationSec,
    required this.onUpload,
    required this.compressBeforeUpload,
    required this.onCompressChanged,
    this.isShort = false,
    this.shorts = const [],
    this.accessMode = 'paid',
    this.onAccessMode,
    this.freePreviewSec = 120,
    this.onFreePreviewSec,
  });

  final TextEditingController titleCtrl;
  final TextEditingController? descCtrl;
  final bool uploading;
  final StudioUploadProgress? uploadProgress;
  final String? phaseLabel;
  final List<Map<String, dynamic>> courses;
  final String? courseId;
  final ValueChanged<String?> onCourse;
  final VoidCallback onSelectVideo;
  final VoidCallback onPickCover;
  final VoidCallback onAutoCover;
  final VoidCallback onClearCover;
  final VoidCallback onClearMedia;
  final File? pendingVideo;
  final File? pendingCover;
  final File? pendingPdf;
  final VoidCallback? onPickPdf;
  final VoidCallback? onClearPdf;
  final int? pendingDurationSec;
  final VoidCallback onUpload;
  final bool compressBeforeUpload;
  final ValueChanged<bool> onCompressChanged;
  final bool isShort;
  final List<Map<String, dynamic>> shorts;
  final String accessMode;
  final ValueChanged<String>? onAccessMode;
  final int freePreviewSec;
  final ValueChanged<int>? onFreePreviewSec;

  bool get _canPublish =>
      titleCtrl.text.trim().isNotEmpty &&
      pendingVideo != null &&
      pendingCover != null &&
      (isShort || courseId != null);

  String _formatDuration(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  String _formatFileSize(File file) {
    final len = file.lengthSync();
    if (len < 1024 * 1024) return '${(len / 1024).toStringAsFixed(1)} KB';
    return '${(len / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final overall = uploadProgress?.overallPercent ?? 0;

    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        if (!isShort) ...[
          ListenableBuilder(
            listenable: titleCtrl,
            builder: (context, _) => _StudioFlowSteps(
              hasDetails: titleCtrl.text.trim().isNotEmpty && courseId != null,
              hasMedia: pendingVideo != null && pendingCover != null,
              hasAccess: true,
            ),
          ),
          const SizedBox(height: 14),
        ],
        _StudioHintBanner(
          icon: isShort ? Icons.movie_filter_outlined : Icons.school_outlined,
          title: isShort
              ? l10n.t('mobile.studio.studioShortHint')
              : l10n.t('mobile.studio.studioCourseHint'),
        ),
        if (uploading && uploadProgress != null) ...[
          const SizedBox(height: 14),
          _UploadProgressCard(
            overallPercent: overall,
            phaseLabel: phaseLabel ?? '',
            byteDetail: uploadProgress!.byteDetail,
            completeLabel: l10n.t('mobile.studio.uploadProgressLabel', {
              'percent': '$overall',
            }),
          ),
        ],
        const SizedBox(height: 16),
        _StudioSectionCard(
          step: isShort ? null : '1',
          title: isShort
              ? l10n.t('mobile.studio.shortTitle')
              : l10n.t('mobile.studio.lessonTitle'),
          icon: Icons.edit_note_rounded,
          child: Column(
            children: [
              TextField(
                controller: titleCtrl,
                enabled: !uploading,
                decoration: InputDecoration(
                  labelText: isShort
                      ? l10n.t('mobile.studio.shortTitle')
                      : l10n.t('mobile.studio.lessonTitle'),
                  prefixIcon: const Icon(Icons.title_rounded, size: 20),
                ),
              ),
              if (isShort && descCtrl != null) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  enabled: !uploading,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: l10n.t('student.comment'),
                    prefixIcon: const Icon(Icons.notes_rounded, size: 20),
                    alignLabelWithHint: true,
                  ),
                ),
              ],
              if (!isShort) ...[
                const SizedBox(height: 12),
                if (courses.isEmpty)
                  Text(
                    l10n.t('student.noCertificatesHint'),
                    style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                  )
                else
                  DropdownButtonFormField<String>(
                    initialValue: courseId,
                    decoration: InputDecoration(
                      labelText: l10n.t('mobile.studio.selectCourse'),
                      prefixIcon: const Icon(
                        Icons.menu_book_outlined,
                        size: 20,
                      ),
                    ),
                    items: courses
                        .map(
                          (c) => DropdownMenuItem(
                            value: c['id']?.toString(),
                            child: Text(
                              c['titleEn']?.toString() ??
                                  l10n.t('student.storeTitle'),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: uploading ? null : onCourse,
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        _StudioSectionCard(
          step: isShort ? null : '2',
          title: l10n.studioVideoFile,
          icon: Icons.videocam_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _MediaPickerTile(
                icon: Icons.video_file_rounded,
                label: pendingVideo == null
                    ? l10n.t('mobile.studio.tapToSelectVideo')
                    : pendingVideo!.path.split(Platform.pathSeparator).last,
                subtitle: pendingVideo != null
                    ? [
                        _formatFileSize(pendingVideo!),
                        if (pendingDurationSec != null)
                          _formatDuration(pendingDurationSec!),
                      ].join(' · ')
                    : null,
                selected: pendingVideo != null,
                onTap: uploading ? null : onSelectVideo,
              ),
              if (pendingVideo != null && !uploading) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: onClearMedia,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: Text(l10n.t('common.cancel')),
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        _StudioSectionCard(
          step: isShort ? null : '2',
          title: l10n.t('mobile.studio.coverRequiredTitle'),
          icon: Icons.image_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.t('mobile.studio.coverRequiredHint'),
                style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, height: 1.4),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _MediaPickerTile(
                      icon: Icons.photo_library_outlined,
                      label: l10n.studioChooseCover,
                      compact: true,
                      selected: pendingCover != null,
                      onTap: uploading || pendingVideo == null
                          ? null
                          : onPickCover,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _MediaPickerTile(
                      icon: Icons.auto_fix_high_outlined,
                      label: l10n.studioFromVideo,
                      compact: true,
                      onTap: uploading || pendingVideo == null
                          ? null
                          : onAutoCover,
                    ),
                  ),
                ],
              ),
              if (pendingCover == null) ...[
                const SizedBox(height: 8),
                Text(
                  l10n.t('mobile.studio.coverRequired'),
                  style: const TextStyle(color: Colors.orangeAccent, fontSize: 12),
                ),
              ],
              if (pendingCover != null) ...[
                const SizedBox(height: 12),
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.file(pendingCover!, fit: BoxFit.cover),
                        Positioned(
                          top: 8,
                          right: 8,
                          child: Material(
                            color: Colors.black54,
                            borderRadius: BorderRadius.circular(20),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(20),
                              onTap: uploading ? null : onClearCover,
                              child: const Padding(
                                padding: EdgeInsets.all(6),
                                child: Icon(
                                  Icons.close,
                                  color: Colors.white,
                                  size: 18,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (!isShort) ...[
          const SizedBox(height: 14),
          _StudioSectionCard(
            step: '3',
            title: l10n.t('mobile.studio.accessTitle'),
            icon: Icons.lock_open_rounded,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.t('mobile.studio.accessHint'),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, height: 1.4),
                ),
                const SizedBox(height: 12),
                _AccessModeCard(
                  selected: accessMode,
                  enabled: !uploading,
                  onChanged: onAccessMode,
                ),
                if (accessMode == 'timedFree') ...[
                  const SizedBox(height: 16),
                  FreeMinutePicker(
                    durationSec: pendingDurationSec ?? 600,
                    valueSec: freePreviewSec,
                    enabled: !uploading,
                    onChanged: onFreePreviewSec ?? (_) {},
                  ),
                ],
                if (accessMode == 'fullFree') ...[
                  const SizedBox(height: 10),
                  Text(
                    l10n.t('mobile.studio.fullFreeHint'),
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.4),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          _StudioSectionCard(
            title: l10n.t('mobile.teacher.attachPdfOptional'),
            icon: Icons.picture_as_pdf_rounded,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _MediaPickerTile(
                  icon: Icons.attach_file_rounded,
                  label: pendingPdf != null
                      ? pendingPdf!.path.split(Platform.pathSeparator).last
                      : l10n.t('mobile.teacher.choosePdf'),
                  subtitle: pendingPdf != null
                      ? _formatFileSize(pendingPdf!)
                      : null,
                  selected: pendingPdf != null,
                  accentColor: Colors.redAccent,
                  onTap: uploading ? null : onPickPdf,
                ),
                if (pendingPdf != null && onClearPdf != null) ...[
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: uploading ? null : onClearPdf,
                      child: Text(l10n.t('mobile.teacher.removePdf')),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 14),
        _StudioSectionCard(
          title: l10n.t('mobile.studio.compressToggleTitle'),
          icon: Icons.compress_rounded,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: compressBeforeUpload,
            onChanged: uploading ? null : onCompressChanged,
            activeThumbColor: AppTheme.accent,
            title: Text(
              compressBeforeUpload
                  ? l10n.t('mobile.studio.compressToggleOn')
                  : l10n.t('mobile.studio.compressToggleOff'),
              style: const TextStyle(fontSize: 13, height: 1.4),
            ),
          ),
        ),
        const SizedBox(height: 20),
        ListenableBuilder(
          listenable: titleCtrl,
          builder: (context, _) => _PublishButton(
            uploading: uploading,
            enabled: _canPublish && !uploading,
            overallPercent: overall,
            phaseLabel: phaseLabel,
            byteDetail: uploadProgress?.byteDetail,
            label: pendingVideo != null && !uploading
                ? l10n.t('mobile.studio.mediaReady')
                : l10n.t('student.videos'),
            onPressed: () {
              FocusManager.instance.primaryFocus?.unfocus();
              onUpload();
            },
          ),
        ),
        if (isShort && shorts.isNotEmpty) ...[
          const SizedBox(height: 28),
          Row(
            children: [
              const Icon(
                Icons.grid_view_rounded,
                color: AppTheme.accent,
                size: 20,
              ),
              const SizedBox(width: 8),
              Text(
                l10n.studioYourShorts,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...shorts.map((s) => _ShortVideoCard(short: s)),
        ],
      ],
    );
  }
}

class _StudioHintBanner extends StatelessWidget {
  const _StudioHintBanner({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.18),
            AppTheme.accent.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppTheme.accent, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.35,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UploadProgressCard extends StatelessWidget {
  const _UploadProgressCard({
    required this.overallPercent,
    required this.phaseLabel,
    required this.completeLabel,
    this.byteDetail,
  });

  final int overallPercent;
  final String phaseLabel;
  final String completeLabel;
  final String? byteDetail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1A1035), Color(0xFF0C1628)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primary.withValues(alpha: 0.15),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 72,
                height: 72,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      width: 72,
                      height: 72,
                      child: CircularProgressIndicator(
                        value: overallPercent / 100,
                        strokeWidth: 6,
                        backgroundColor: Colors.white12,
                        color: AppTheme.accent,
                        strokeCap: StrokeCap.round,
                      ),
                    ),
                    Text(
                      '$overallPercent%',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      phaseLabel,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      completeLabel,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12.5,
                      ),
                    ),
                    if (byteDetail != null && byteDetail!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        byteDetail!,
                        style: TextStyle(
                          color: AppTheme.accent.withValues(alpha: 0.9),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: math.max(overallPercent / 100, 0.02),
              minHeight: 8,
              backgroundColor: Colors.white10,
              color: AppTheme.accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _StudioFlowSteps extends StatelessWidget {
  const _StudioFlowSteps({
    required this.hasDetails,
    required this.hasMedia,
    required this.hasAccess,
  });

  final bool hasDetails;
  final bool hasMedia;
  final bool hasAccess;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final steps = [
      (l10n.t('mobile.studio.stepDetails'), hasDetails),
      (l10n.t('mobile.studio.stepMedia'), hasMedia),
      (l10n.t('mobile.studio.stepAccess'), hasAccess),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        children: [
          for (var i = 0; i < steps.length; i++) ...[
            if (i > 0)
              Expanded(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.symmetric(horizontal: 6),
                  color: steps[i].$2 || steps[i - 1].$2
                      ? AppTheme.accent.withValues(alpha: 0.55)
                      : AppTheme.cardBorder,
                ),
              ),
            Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: steps[i].$2 ? AppTheme.accent : AppTheme.cardBorder,
                  ),
                  child: steps[i].$2
                      ? const Icon(Icons.check_rounded, size: 16, color: Colors.black)
                      : Text(
                          '${i + 1}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: AppTheme.muted,
                          ),
                        ),
                ),
                const SizedBox(height: 6),
                Text(
                  steps[i].$1,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: steps[i].$2 ? AppTheme.accent : AppTheme.muted,
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

class _AccessModeCard extends StatelessWidget {
  const _AccessModeCard({
    required this.selected,
    required this.onChanged,
    this.enabled = true,
  });

  final String selected;
  final ValueChanged<String>? onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final options = [
      ('paid', Icons.lock_outline_rounded, l10n.t('mobile.studio.accessPaid'), l10n.t('mobile.studio.accessPaidHint')),
      ('timedFree', Icons.timelapse_rounded, l10n.t('mobile.studio.accessTimed'), l10n.t('mobile.studio.accessTimedHint')),
      ('fullFree', Icons.lock_open_rounded, l10n.t('mobile.studio.accessFullFree'), l10n.t('mobile.studio.accessFullFreeHint')),
    ];
    return Column(
      children: [
        for (final o in options) ...[
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: enabled && onChanged != null ? () => onChanged!(o.$1) : null,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: selected == o.$1
                        ? AppTheme.accent
                        : AppTheme.cardBorder,
                    width: selected == o.$1 ? 1.6 : 1,
                  ),
                  color: selected == o.$1
                      ? AppTheme.accent.withValues(alpha: 0.1)
                      : Colors.white.withValues(alpha: 0.02),
                ),
                child: Row(
                  children: [
                    Icon(
                      o.$2,
                      color: selected == o.$1 ? AppTheme.accent : AppTheme.muted,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            o.$3,
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              color: selected == o.$1 ? Colors.white : null,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            o.$4,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.muted,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (selected == o.$1)
                      const Icon(Icons.check_circle_rounded, color: AppTheme.accent, size: 20),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _StudioSectionCard extends StatelessWidget {
  const _StudioSectionCard({
    required this.title,
    required this.icon,
    required this.child,
    this.step,
  });

  final String title;
  final IconData icon;
  final Widget child;
  final String? step;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.cardBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (step != null) ...[
                Container(
                  width: 24,
                  height: 24,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    step!,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.accent,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 18, color: AppTheme.accent),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _MediaPickerTile extends StatelessWidget {
  const _MediaPickerTile({
    required this.icon,
    required this.label,
    this.subtitle,
    this.onTap,
    this.selected = false,
    this.compact = false,
    this.accentColor,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback? onTap;
  final bool selected;
  final bool compact;
  final Color? accentColor;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.accent;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? color.withValues(alpha: 0.6)
                  : AppTheme.cardBorder,
              width: selected ? 1.5 : 1,
            ),
            color: selected
                ? color.withValues(alpha: 0.06)
                : const Color(0xFF080812),
          ),
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 10 : 14,
            vertical: compact ? 12 : 16,
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: compact ? 20 : 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w600,
                        fontSize: compact ? 12.5 : 13.5,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          color: AppTheme.muted,
                          fontSize: 11.5,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null)
                Icon(
                  selected
                      ? Icons.check_circle_rounded
                      : Icons.chevron_right_rounded,
                  color: selected ? Colors.greenAccent : AppTheme.muted,
                  size: 22,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PublishButton extends StatelessWidget {
  const _PublishButton({
    required this.uploading,
    required this.enabled,
    required this.overallPercent,
    required this.phaseLabel,
    required this.label,
    required this.onPressed,
    this.byteDetail,
  });

  final bool uploading;
  final bool enabled;
  final int overallPercent;
  final String? phaseLabel;
  final String? byteDetail;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 54,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: enabled || uploading ? AppTheme.gradient : null,
          color: enabled || uploading ? null : AppTheme.cardBorder,
          borderRadius: BorderRadius.circular(16),
          boxShadow: enabled || uploading
              ? [
                  BoxShadow(
                    color: AppTheme.primary.withValues(alpha: 0.35),
                    blurRadius: 16,
                    offset: const Offset(0, 6),
                  ),
                ]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: enabled ? onPressed : null,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (uploading) ...[
                    SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        value: overallPercent > 0 ? overallPercent / 100 : null,
                        strokeWidth: 2.5,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '$overallPercent%',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        if (phaseLabel != null && phaseLabel!.isNotEmpty)
                          Text(
                            phaseLabel!,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.w500,
                              fontSize: 11.5,
                            ),
                          ),
                        if (byteDetail != null && byteDetail!.isNotEmpty)
                          Text(
                            byteDetail!,
                            style: const TextStyle(
                              color: Colors.white60,
                              fontSize: 10.5,
                            ),
                          ),
                      ],
                    ),
                  ] else ...[
                    const Icon(Icons.cloud_upload_rounded, color: Colors.white),
                    const SizedBox(width: 10),
                    Text(
                      label,
                      style: TextStyle(
                        color: enabled ? Colors.white : AppTheme.muted,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ShortVideoCard extends StatelessWidget {
  const _ShortVideoCard({required this.short});

  final Map<String, dynamic> short;

  Color _statusColor(String status) {
    return switch (status.toUpperCase()) {
      'DRAFT' => Colors.blueGrey,
      'APPROVED' || 'PUBLISHED' => Colors.greenAccent,
      'PENDING' || 'PENDING_REVIEW' => Colors.orangeAccent,
      'REJECTED' => Colors.redAccent,
      _ => AppTheme.muted,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final status = short['status']?.toString() ?? '';
    final thumb = short['thumbnailUrl']?.toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.fromLTRB(12, 8, 14, 8),
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: thumb != null && thumb.isNotEmpty
              ? Image.network(
                  thumb,
                  width: 56,
                  height: 56,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => _thumbPlaceholder(),
                )
              : _thumbPlaceholder(),
        ),
        title: Text(
          short['title']?.toString() ?? '',
          style: const TextStyle(fontWeight: FontWeight.w700),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          [
            if (short['description'] != null &&
                short['description'].toString().trim().isNotEmpty)
              short['description'].toString(),
            '${l10n.homeViews((short['viewCount'] as num?)?.toInt() ?? 0)} · ${l10n.homeLikes((short['likes'] as num?)?.toInt() ?? 0)}',
          ].where((t) => t.isNotEmpty).join('\n'),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 12,
            color: AppTheme.muted,
            height: 1.35,
          ),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: _statusColor(status).withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: _statusColor(status).withValues(alpha: 0.35),
            ),
          ),
          child: Text(
            status.replaceAll('_', ' '),
            style: TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w700,
              color: _statusColor(status),
            ),
          ),
        ),
      ),
    );
  }

  Widget _thumbPlaceholder() {
    return Container(
      width: 56,
      height: 56,
      color: AppTheme.primary.withValues(alpha: 0.15),
      child: const Icon(Icons.movie_outlined, color: AppTheme.accent),
    );
  }
}
