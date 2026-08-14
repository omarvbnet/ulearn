import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/video_process_service.dart';
import 'package:ulearn/core/video/video_upload_service.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// 5-step course creation wizard: basics → free videos → quizzes → document → submit.
class TeacherCourseWizardScreen extends StatefulWidget {
  const TeacherCourseWizardScreen({super.key, this.courseId, this.initialStep = 0});

  final String? courseId;
  final int initialStep;

  @override
  State<TeacherCourseWizardScreen> createState() => _TeacherCourseWizardScreenState();
}

class _TeacherCourseWizardScreenState extends State<TeacherCourseWizardScreen> {
  late int _step;
  String? _courseId;
  bool _loading = true;
  bool _busy = false;
  String? _busyLabel;
  double? _busyProgress; // 0–1 for overlay bar
  Timer? _busyUiTimer;

  List<String> _stepLabels(dynamic l10n) => [
        l10n.t('mobile.teacher.stepBasics'),
        l10n.t('mobile.teacher.stepFreeVideos'),
        l10n.t('mobile.teacher.stepQuizzes'),
        l10n.t('mobile.teacher.stepDocument'),
        l10n.t('mobile.teacher.stepSubmit'),
      ];

  // Step 1
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController(text: '0');
  List<Map<String, dynamic>> _specialties = [];
  List<Map<String, dynamic>> _stages = [];
  String? _subjectId;
  String? _stageId;
  File? _coverFile;
  String? _coverUrl;

  // Course payload
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _readiness;

  // Step 3 quiz draft
  final _quizTitleCtrl = TextEditingController();
  final List<_WizardQuizQ> _quizQs = [_WizardQuizQ()];
  String? _quizAfterLessonId;
  String? _docLessonId;

  @override
  void initState() {
    super.initState();
    _step = widget.initialStep.clamp(0, 4);
    _courseId = widget.courseId;
    _bootstrap();
  }

  @override
  void dispose() {
    _busyUiTimer?.cancel();
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    _quizTitleCtrl.dispose();
    for (final q in _quizQs) {
      q.dispose();
    }
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final api = context.read<ApiClient>();
      final profile = await api.get('/api/profile/teacher');
      if (!mounted) return;
      _specialties = ((profile['specialties'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
      _stages =
          ((profile['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      _subjectId =
          _specialties.length == 1 ? _specialties.first['id']?.toString() : null;

      if (_courseId != null) {
        await _reloadCourse();
        final r = await api.get('/api/teacher/courses/$_courseId/readiness');
        _readiness = r['readiness'] as Map<String, dynamic>?;
        _step = _suggestedStep(_readiness);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  int _suggestedStep(Map<String, dynamic>? r) {
    if (r == null) return 0;
    if (r['hasTitle'] != true || r['hasCover'] != true) return 0;
    final sampleOk = r['hasSampleAccess'] == true ||
        ((r['freeVideos'] as num?) ?? 0) >= 2 ||
        ((r['timedFreeSec'] as num?) ?? 0) >= 120;
    if (!sampleOk) return 1;
    if (((r['quizzes'] as num?) ?? 0) < 2) return 2;
    if (((r['documents'] as num?) ?? 0) < 1) return 3;
    return 4;
  }

  Future<void> _reloadCourse() async {
    if (_courseId == null) return;
    final data = await context.read<ApiClient>().get('/api/teacher/courses/$_courseId');
    final course = data['course'] as Map<String, dynamic>;
    _course = course;
    _titleCtrl.text = course['titleEn']?.toString() ?? '';
    _descCtrl.text = course['description']?.toString() ?? '';
    _priceCtrl.text = (course['price'] as num?)?.toString() ?? '0';
    _subjectId = course['subjectId']?.toString() ?? _subjectId;
    _stageId = course['stageId']?.toString() ?? _stageId;
    _coverUrl = course['thumbnail']?.toString();
    if (_selectedSectionId == null) {
      final sections = ((course['sections'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
      if (sections.isNotEmpty) {
        _selectedSectionId = sections.first['id']?.toString();
      }
    }
  }

  Future<void> _refreshReadiness() async {
    if (_courseId == null) return;
    final r = await context.read<ApiClient>().get('/api/teacher/courses/$_courseId/readiness');
    if (!mounted) return;
    setState(() => _readiness = r['readiness'] as Map<String, dynamic>?);
  }

  List<Map<String, dynamic>> get _lessons =>
      ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  bool get _usesSections => _course?['usesSections'] == true;

  List<Map<String, dynamic>> get _sections =>
      ((_course?['sections'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  String? _selectedSectionId;

  List<Map<String, dynamic>> get _quizzes =>
      ((_course?['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _materials {
    final fromCourse = ((_course?['materials'] as List<dynamic>?) ?? [])
        .cast<Map<String, dynamic>>();
    if (fromCourse.isNotEmpty) return fromCourse;
    final nested = <Map<String, dynamic>>[];
    for (final l in _lessons) {
      nested.addAll(((l['materials'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>());
    }
    return nested;
  }

  int get _freeCount =>
      _lessons.where((l) => l['isFreePreview'] == true && l['deletedAt'] == null).length;

  int get _timedFreeSec {
    var maxSec = 0;
    for (final l in _lessons) {
      if (l['isFreePreview'] == true) continue;
      final s = (l['freePreviewSec'] as num?)?.toInt() ?? 0;
      if (s > maxSec) maxSec = s;
    }
    return maxSec;
  }

  bool get _hasSampleAccess =>
      _freeCount >= 2 ||
      _timedFreeSec >= 120 ||
      _readiness?['hasSampleAccess'] == true;

  bool get _hasInterview => _lessons.any((l) => l['isInterview'] == true);

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  void _setBusyUi(String label, {double? progress, bool force = false}) {
    if (!mounted) return;
    _busy = true;
    _busyLabel = label;
    if (progress != null) _busyProgress = progress.clamp(0.0, 1.0);

    // Use a Timer so progress paints while idle (post-frame only runs after scroll).
    if (force) {
      _busyUiTimer?.cancel();
      _busyUiTimer = null;
      setState(() {});
      return;
    }
    if (_busyUiTimer?.isActive ?? false) return;
    _busyUiTimer = Timer(const Duration(milliseconds: 80), () {
      _busyUiTimer = null;
      if (mounted) setState(() {});
    });
  }

  Future<void> _saveBasicsAndNext() async {
    final l10n = context.l10n;
    if (_titleCtrl.text.trim().isEmpty || _subjectId == null || _stageId == null) {
      _toast(l10n.t('mobile.teacher.fillBasics'));
      return;
    }
    final price = double.tryParse(_priceCtrl.text.trim());
    if (price == null || price < 0) {
      _toast(l10n.t('mobile.teacher.enterValidPrice'));
      return;
    }

    setState(() {
      _busy = true;
      _busyLabel = l10n.t('mobile.teacher.savingCourse');
    });
    try {
      final api = context.read<ApiClient>();
      String? thumbnail = _coverUrl;

      if (_coverFile != null) {
        setState(() => _busyLabel = l10n.t('mobile.teacher.uploadingCover'));
        final size = await _coverFile!.length();
        final ext = _coverFile!.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        final presign = await api.post('/api/admin/uploads', {
          'filename': 'cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
          'contentType': ext == 'png' ? 'image/png' : 'image/jpeg',
          'size': size,
          'category': 'image',
          'folder': 'teacher-covers',
        });
        final uploadUrl = presign['uploadUrl']?.toString();
        final publicUrl = presign['publicUrl']?.toString();
        if (uploadUrl == null) throw Exception(l10n.t('mobile.teacher.coverUploadFailed'));
        await api.putFile(
          uploadUrl,
          _coverFile!,
          ext == 'png' ? 'image/png' : 'image/jpeg',
        );
        thumbnail = publicUrl;
      }

      if (thumbnail == null || thumbnail.isEmpty) {
        _toast(l10n.t('mobile.teacher.addCourseCover'));
        return;
      }

      if (_courseId == null) {
        final created = await api.post('/api/teacher/courses', {
          'titleEn': _titleCtrl.text.trim(),
          if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
          'subjectId': _subjectId,
          'stageId': _stageId,
          'price': price,
          'thumbnail': thumbnail,
        });
        _courseId = (created['course'] as Map?)?['id']?.toString() ??
            created['id']?.toString();
      } else {
        await api.patch('/api/teacher/courses/$_courseId', {
          'titleEn': _titleCtrl.text.trim(),
          'description': _descCtrl.text.trim(),
          'subjectId': _subjectId,
          'stageId': _stageId,
          'price': price,
          'thumbnail': thumbnail,
        });
      }

      if (thumbnail.isNotEmpty) {
        await evictCachedImage(_coverUrl);
        await evictCachedImage(thumbnail);
        _coverUrl = thumbnail;
        _coverFile = null;
      }

      await _reloadCourse();
      await _refreshReadiness();
      if (!mounted) return;
      setState(() => _step = 1);
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _uploadFreeVideo({required bool interview}) async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_courseId == null) return;
    final l10n = context.l10n;
    if (!interview && !_hasInterview) {
      _toast(l10n.t('mobile.teacher.uploadInterviewFirst'));
      return;
    }
    if (_freeCount >= 2) {
      _toast(l10n.t('mobile.teacher.maxFreePreviews'));
      return;
    }

    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final source = File(pick.files.first.path!);

    final titleCtrl = TextEditingController(
      text: interview ? l10n.t('mobile.teacher.interviewIntro') : l10n.t('mobile.teacher.freeSample'),
    );
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          interview
              ? l10n.t('mobile.teacher.interviewVideoTitle')
              : l10n.t('mobile.teacher.freeSampleVideoTitle'),
        ),
        content: TextField(
          controller: titleCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.videoTitleLabel')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(context.l10n.cancel)),
          TextButton(
            onPressed: () {
              FocusManager.instance.primaryFocus?.unfocus();
              Navigator.pop(ctx, titleCtrl.text.trim());
            },
            child: Text(l10n.t('mobile.teacher.uploadBtn')),
          ),
        ],
      ),
    );
    if (title == null || title.isEmpty || !mounted) return;

    setState(() {
      _busy = true;
      _busyLabel = l10n.t('mobile.teacher.processingVideo');
      _busyProgress = 0.02;
    });
    try {
      final api = context.read<ApiClient>();
      final upload = VideoUploadService(api);
      final sourceSize = await source.length();
      final processed = await VideoProcessService.processForUpload(
        source: source,
        onProgress: (p) {
          _setBusyUi(
            l10n.t('mobile.teacher.convertingVideo', {
              'size': VideoProcessService.formatBytes(sourceSize),
              'percent': '${(p * 100).round()}',
            }),
            progress: p * 0.55,
          );
        },
      );

      final uploadSize = await processed.file.length();
      _setBusyUi(
        l10n.t('mobile.teacher.uploadingProgress', {
          'sent': '0 MB',
          'total': VideoProcessService.formatBytes(uploadSize),
          'percent': '0',
        }),
        progress: 0.55,
        force: true,
      );
      final duration = await VideoCoverHelper.videoDurationSec(processed.file.path);
      final result = await upload.uploadCourseVideo(
        file: processed.file,
        courseId: _courseId!,
        scope: 'STORE_COURSE',
        durationSec: duration,
        watermarkApplied: false,
        onProgress: (sent, total) {
          if (total <= 0) return;
          final pct = (sent * 100 / total).round();
          _setBusyUi(
            l10n.t('mobile.teacher.uploadingProgress', {
              'sent': _formatBytes(sent),
              'total': _formatBytes(total),
              'percent': '$pct',
            }),
            progress: 0.55 + (sent / total) * 0.45,
          );
        },
      );

      _setBusyUi(l10n.t('mobile.teacher.savingLesson'), progress: 0.98, force: true);

      await api.post('/api/teacher/courses/$_courseId/lessons', {
        'title': title,
        'fileKey': result.objectKey,
        'videoAssetId': result.videoId,
        'durationSec': duration,
        'isFreePreview': true,
        'isInterview': interview,
        if (_usesSections && _selectedSectionId != null)
          'sectionId': _selectedSectionId,
      });

      await _reloadCourse();
      await _refreshReadiness();
      if (mounted) setState(() {});
      _toast(
        interview
            ? l10n.t('mobile.teacher.interviewAdded')
            : l10n.t('mobile.teacher.freeSampleAdded'),
      );
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
          _busyProgress = null;
        });
      }
    }
  }

  Future<void> _saveQuiz() async {
    if (_courseId == null) return;
    final l10n = context.l10n;
    final questions = _quizQs.map((q) => q.toPayload()).whereType<Map<String, dynamic>>().toList();
    if (_quizTitleCtrl.text.trim().isEmpty || questions.isEmpty) {
      _toast(l10n.t('mobile.teacher.quizTitleRequired'));
      return;
    }
    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/$_courseId/quizzes', {
        'titleEn': _quizTitleCtrl.text.trim(),
        if (_quizAfterLessonId != null) 'afterLessonId': _quizAfterLessonId,
        'questions': questions,
      });
      _quizTitleCtrl.clear();
      _quizAfterLessonId = null;
      for (final q in _quizQs) {
        q.dispose();
      }
      _quizQs
        ..clear()
        ..add(_WizardQuizQ());
      await _reloadCourse();
      await _refreshReadiness();
      if (mounted) setState(() {});
      _toast(l10n.t('mobile.teacher.quizSaved'));
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _uploadDocument() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_courseId == null) return;
    final l10n = context.l10n;
    final pick = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final file = File(pick.files.first.path!);
    final name = pick.files.first.name;

    setState(() {
      _busy = true;
      _busyLabel = l10n.t('mobile.teacher.uploadingDocument');
    });
    try {
      final api = context.read<ApiClient>();
      final size = await file.length();
      final presign = await api.post('/api/admin/uploads', {
        'filename': name.endsWith('.pdf') ? name : '$name.pdf',
        'contentType': 'application/pdf',
        'size': size,
        'category': 'document',
        'folder': 'teacher-course-pdfs',
      });
      final uploadUrl = presign['uploadUrl']?.toString();
      final key = presign['key']?.toString();
      if (uploadUrl == null || key == null) throw Exception(l10n.t('mobile.teacher.uploadFailed'));
      await api.putFile(uploadUrl, file, 'application/pdf');
      final docTitle = name
          .replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '')
          .trim();
      await api.post('/api/teacher/courses/$_courseId/documents', {
        'title': docTitle.isEmpty ? 'Course PDF' : docTitle,
        'fileKey': key,
        'mimeType': 'application/pdf',
        'fileSize': size,
        'type': 'PDF',
        if (_docLessonId != null) 'lessonId': _docLessonId,
      });
      await _reloadCourse();
      await _refreshReadiness();
      // documents may not be on course GET — fetch separately
      try {
        final docs = await api.get('/api/teacher/courses/$_courseId/documents');
        _course = {
          ...?_course,
          'materials': docs['documents'],
        };
      } catch (_) {}
      if (mounted) setState(() {});
      _toast(l10n.t('mobile.teacher.documentUploaded'));
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _submitForReview() async {
    if (_courseId == null) return;
    final l10n = context.l10n;
    setState(() => _busy = true);
    try {
      await _refreshReadiness();
      if (_readiness?['ready'] != true) {
        final missing = ((_readiness?['missing'] as List?) ?? []).join(', ');
        _toast(
          missing.isEmpty
              ? l10n.t('mobile.teacher.courseNotReady')
              : l10n.t('mobile.teacher.missingItems', {'items': missing}),
        );
        return;
      }
      await context.read<ApiClient>().post('/api/teacher/courses/$_courseId/submit', {});
      if (!mounted) return;
      _toast(l10n.t('mobile.teacher.submittedForReview'));
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  bool _canGoNext() {
    switch (_step) {
      case 0:
        return _titleCtrl.text.trim().isNotEmpty &&
            _subjectId != null &&
            _stageId != null &&
            (_coverFile != null || (_coverUrl != null && _coverUrl!.isNotEmpty));
      case 1:
        if (_usesSections && _sections.isEmpty) return false;
        return _hasSampleAccess;
      case 2:
        return _quizzes.length >= 2;
      case 3:
        return _materials.isNotEmpty || ((_readiness?['documents'] as num?) ?? 0) >= 1;
      default:
        return _readiness?['ready'] == true;
    }
  }

  Future<void> _next() async {
    if (_step == 0) {
      await _saveBasicsAndNext();
      return;
    }
    if (_step < 4) {
      await _refreshReadiness();
      if (!_canGoNext()) {
        _toast(context.l10n.t('mobile.teacher.completeStepFirst'));
        return;
      }
      setState(() => _step++);
      return;
    }
    await _submitForReview();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;
    final steps = _stepLabels(l10n);

    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: Scaffold(
      appBar: GlassAppBar(
        title: Text(l10n.t('mobile.teacher.wizardTitle')),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(72),
          child: _StepHeader(steps: steps, current: _step),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _specialties.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.t('mobile.teacher.specialtiesRequired'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppTheme.muted, height: 1.5),
                    ),
                  ),
                )
              : Stack(
                  children: [
                    ListView(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
                      children: [
                        if (_step == 0) _buildBasics(locale),
                        if (_step == 1) _buildVideos(),
                        if (_step == 2) _buildQuizzes(),
                        if (_step == 3) _buildDocument(),
                        if (_step == 4) _buildSubmit(),
                      ],
                    ),
                    if (_busy)
                      Positioned.fill(
                        child: ColoredBox(
                          color: Colors.black54,
                          child: Center(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 32),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SizedBox(
                                    width: 56,
                                    height: 56,
                                    child: CircularProgressIndicator(
                                      value: _busyProgress,
                                      color: AppTheme.accent,
                                      backgroundColor: Colors.white24,
                                      strokeWidth: 5,
                                    ),
                                  ),
                                  if (_busyLabel != null) ...[
                                    const SizedBox(height: 16),
                                    Text(
                                      _busyLabel!,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15,
                                      ),
                                    ),
                                  ],
                                  if (_busyProgress != null) ...[
                                    const SizedBox(height: 14),
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(8),
                                      child: LinearProgressIndicator(
                                        value: _busyProgress!.clamp(0.02, 1.0),
                                        minHeight: 8,
                                        backgroundColor: Colors.white12,
                                        color: AppTheme.accent,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      '${(_busyProgress! * 100).round()}%',
                                      style: const TextStyle(
                                        color: Colors.white70,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
      bottomNavigationBar: _specialties.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    if (_step > 0)
                      OutlinedButton(
                        onPressed: _busy ? null : () => setState(() => _step--),
                        child: Text(l10n.t('mobile.teacher.back')),
                      ),
                    const Spacer(),
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : () {
                              FocusManager.instance.primaryFocus?.unfocus();
                              _next();
                            },
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.accent,
                        foregroundColor: Colors.black,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                      ),
                      child: Text(
                        _step == 4
                            ? l10n.t('mobile.teacher.submitForReview')
                            : l10n.t('mobile.teacher.continueBtn'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
      ),
    );
  }

  Widget _buildBasics(String locale) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.teacher.basicsTitle'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('mobile.teacher.basicsHint'),
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _titleCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.courseTitle')),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _descCtrl,
          maxLines: 3,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.courseDescription')),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _subjectId,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.subjectLabel')),
          items: _specialties
              .map(
                (s) => DropdownMenuItem(
                  value: s['id']?.toString(),
                  child: Text(localizedText(s, locale, prefix: 'name')),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _subjectId = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _stageId,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.stageLabel')),
          items: _stages
              .map(
                (s) => DropdownMenuItem(
                  value: s['id']?.toString(),
                  child: Text(localizedText(s, locale, prefix: 'name')),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _stageId = v),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _priceCtrl,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.coursePrice')),
        ),
        const SizedBox(height: 16),
        GestureDetector(
          onTap: () async {
            final cover = await VideoCoverHelper.pickCoverImage();
            if (cover != null) setState(() => _coverFile = cover);
          },
          child: Container(
            height: 180,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.cardBorder),
              color: AppTheme.card,
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (_coverFile != null)
                  Image.file(_coverFile!, fit: BoxFit.cover)
                else if (_coverUrl != null && _coverUrl!.isNotEmpty)
                  CachedImage(url: _coverUrl!, fit: BoxFit.cover)
                else
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined, size: 40, color: AppTheme.muted),
                      const SizedBox(height: 8),
                      Text(l10n.t('mobile.teacher.tapToAddCover'), style: TextStyle(color: AppTheme.muted)),
                    ],
                  ),
                if (_coverFile != null || (_coverUrl != null && _coverUrl!.isNotEmpty))
                  Align(
                    alignment: Alignment.bottomRight,
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Chip(
                        label: Text(l10n.t('mobile.teacher.changeCover')),
                        backgroundColor: Colors.black54,
                        labelStyle: const TextStyle(color: Colors.white, fontSize: 12),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _addWizardSection() async {
    final l10n = context.l10n;
    final ctrl = TextEditingController();
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.t('mobile.teacher.addSection')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.sectionTitle')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: Text(l10n.save),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (title == null || title.isEmpty || _courseId == null || !mounted) return;
    try {
      final created = await context.read<ApiClient>().post(
        '/api/teacher/courses/$_courseId/sections',
        {'title': title},
      );
      await _reloadCourse();
      final section = created['section'] as Map?;
      _selectedSectionId = section?['id']?.toString() ?? _selectedSectionId;
      if (mounted) setState(() {});
    } catch (e) {
      _toast(e.toString());
    }
  }

  Widget _buildVideos() {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.teacher.videosTitle'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('mobile.teacher.videosHintOptional'),
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        if (_usesSections) ...[
          const SizedBox(height: 16),
          Text(
            l10n.t('mobile.teacher.sectionsSection'),
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.t('mobile.teacher.sectionRequired'),
            style: TextStyle(color: AppTheme.muted, fontSize: 12.5, height: 1.4),
          ),
          const SizedBox(height: 10),
          FilledButton.tonalIcon(
            onPressed: _busy ? null : _addWizardSection,
            icon: const Icon(Icons.create_new_folder_outlined),
            label: Text(l10n.t('mobile.teacher.addSection')),
          ),
          const SizedBox(height: 8),
          for (final s in _sections)
            RadioListTile<String>(
              value: s['id']?.toString() ?? '',
              groupValue: _selectedSectionId,
              title: Text(s['title']?.toString() ?? ''),
              onChanged: (v) => setState(() => _selectedSectionId = v),
              dense: true,
            ),
        ],
        const SizedBox(height: 16),
        _RequirementChip(
          label: l10n.t('mobile.teacher.interviewBadge'),
          done: _hasInterview,
        ),
        const SizedBox(height: 8),
        _RequirementChip(
          label: l10n.t('mobile.teacher.freeVideosCount', {'count': '$_freeCount'}),
          done: _freeCount >= 2,
        ),
        const SizedBox(height: 8),
        _RequirementChip(
          label: l10n.t('mobile.teacher.timedFreeCount', {
            'minutes': '${(_timedFreeSec / 60).floor()}',
          }),
          done: _timedFreeSec >= 120,
        ),
        const SizedBox(height: 8),
        _RequirementChip(
          label: l10n.t('mobile.teacher.sampleAccessOk'),
          done: _hasSampleAccess,
        ),
        const SizedBox(height: 16),
        ..._lessons.where((l) => l['isFreePreview'] == true).map((l) {
          final interview = l['isInterview'] == true;
          return Card(
            color: AppTheme.card,
            child: ListTile(
              leading: Icon(
                interview ? Icons.mic_rounded : Icons.play_circle_outline,
                color: AppTheme.accent,
              ),
              title: Text(l['title']?.toString() ?? l10n.t('mobile.teacher.videoFallback')),
              subtitle: Text(
                interview
                    ? l10n.t('mobile.teacher.interviewIntro')
                    : l10n.t('mobile.teacher.freeSample'),
              ),
            ),
          );
        }),
        const SizedBox(height: 12),
        if (!_hasInterview)
          FilledButton.icon(
            onPressed: _busy || (_usesSections && _selectedSectionId == null)
                ? null
                : () => _uploadFreeVideo(interview: true),
            icon: const Icon(Icons.mic_rounded),
            label: Text(l10n.t('mobile.teacher.uploadInterview')),
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
          )
        else if (_freeCount < 2)
          FilledButton.icon(
            onPressed: _busy || (_usesSections && _selectedSectionId == null)
                ? null
                : () => _uploadFreeVideo(interview: false),
            icon: const Icon(Icons.video_call_outlined),
            label: Text(l10n.t('mobile.teacher.uploadFreeSample')),
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
          ),
      ],
    );
  }

  Widget _buildQuizzes() {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.teacher.quizzesTitle'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('mobile.teacher.quizzesHint', {'count': '${_quizzes.length}'}),
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 12),
        ..._quizzes.map(
          (q) {
            final qCount = (q['_count'] as Map?)?['questions'] ?? q['questionCount'] ?? '?';
            final afterId = q['afterLessonId']?.toString();
            String afterLabel = l10n.studioAtEndOfCourse;
            if (afterId != null && afterId.isNotEmpty) {
              for (final l in _lessons) {
                if (l['id']?.toString() == afterId) {
                  afterLabel = l['title']?.toString() ?? afterLabel;
                  break;
                }
              }
            }
            return Card(
              color: AppTheme.card,
              child: ListTile(
                leading: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
                title: Text(q['titleEn']?.toString() ?? l10n.t('mobile.teacher.quizzesTitle')),
                subtitle: Text(
                  '${l10n.t('mobile.teacher.questionsCount', {'count': '$qCount'})}\n'
                  '${l10n.t('mobile.teacher.afterVideoLabel')}: $afterLabel',
                ),
                isThreeLine: true,
              ),
            );
          },
        ),
        if (_quizzes.length < 2) ...[
          const SizedBox(height: 16),
          TextField(
            controller: _quizTitleCtrl,
            decoration: InputDecoration(labelText: l10n.t('mobile.teacher.newQuizTitle')),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            initialValue: _quizAfterLessonId,
            decoration: InputDecoration(
              labelText: l10n.t('mobile.teacher.placeAfterVideo'),
              helperText: l10n.t('mobile.teacher.placeOptionalHint'),
            ),
            items: [
              DropdownMenuItem(value: null, child: Text(l10n.studioAtEndOfCourse)),
              ..._lessons.map(
                (l) => DropdownMenuItem(
                  value: l['id']?.toString(),
                  child: Text(
                    l['title']?.toString() ?? l10n.t('student.videos'),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
            onChanged: (v) => setState(() => _quizAfterLessonId = v),
          ),
          const SizedBox(height: 12),
          ..._quizQs.asMap().entries.map((e) {
            final i = e.key;
            final q = e.value;
            return Card(
              color: AppTheme.card,
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    TextField(
                      controller: q.textCtrl,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.studio.questionNumber', {'n': '${i + 1}'}),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: q.optA,
                      decoration: InputDecoration(labelText: l10n.t('mobile.teacher.optionA')),
                    ),
                    TextField(
                      controller: q.optB,
                      decoration: InputDecoration(labelText: l10n.t('mobile.teacher.optionB')),
                    ),
                    TextField(
                      controller: q.optC,
                      decoration: InputDecoration(labelText: l10n.t('mobile.teacher.optionCOptional')),
                    ),
                    DropdownButtonFormField<String>(
                      value: q.correct,
                      decoration: InputDecoration(labelText: l10n.t('mobile.studio.correctAnswer')),
                      items: const [
                        DropdownMenuItem(value: 'A', child: Text('A')),
                        DropdownMenuItem(value: 'B', child: Text('B')),
                        DropdownMenuItem(value: 'C', child: Text('C')),
                        DropdownMenuItem(value: 'D', child: Text('D')),
                      ],
                      onChanged: (v) => setState(() => q.correct = v ?? 'A'),
                    ),
                  ],
                ),
              ),
            );
          }),
          TextButton.icon(
            onPressed: () => setState(() => _quizQs.add(_WizardQuizQ())),
            icon: const Icon(Icons.add),
            label: Text(l10n.t('mobile.studio.addQuestion')),
          ),
          FilledButton(
            onPressed: _busy ? null : _saveQuiz,
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
            child: Text(l10n.t('mobile.studio.saveQuiz')),
          ),
        ],
      ],
    );
  }

  Widget _buildDocument() {
    final l10n = context.l10n;
    final docs = _materials;
    final docCount = ((_readiness?['documents'] as num?) ?? docs.length).toInt();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.teacher.documentTitle'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('mobile.teacher.documentCountHint', {'count': '$docCount'}),
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 12),
        ...docs.map(
          (d) {
            final lessonId = d['lessonId']?.toString();
            String place = l10n.t('mobile.teacher.courseLevelDoc');
            if (lessonId != null && lessonId.isNotEmpty) {
              for (final l in _lessons) {
                if (l['id']?.toString() == lessonId) {
                  place = l['title']?.toString() ?? place;
                  break;
                }
              }
            }
            return Card(
              color: AppTheme.card,
              child: ListTile(
                leading: const Icon(Icons.picture_as_pdf, color: AppTheme.accent),
                title: Text(d['title']?.toString() ?? l10n.t('mobile.teacher.documentFallback')),
                subtitle: Text('${l10n.t('mobile.teacher.afterVideoLabel')}: $place'),
              ),
            );
          },
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          initialValue: _docLessonId,
          decoration: InputDecoration(
            labelText: l10n.t('mobile.teacher.placeAfterVideo'),
            helperText: l10n.t('mobile.teacher.placeOptionalHint'),
          ),
          items: [
            DropdownMenuItem(value: null, child: Text(l10n.t('mobile.teacher.courseLevelDoc'))),
            ..._lessons.map(
              (l) => DropdownMenuItem(
                value: l['id']?.toString(),
                child: Text(
                  l['title']?.toString() ?? l10n.t('student.videos'),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          onChanged: (v) => setState(() => _docLessonId = v),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _uploadDocument,
          icon: const Icon(Icons.upload_file),
          label: Text(l10n.t('mobile.teacher.uploadPdf')),
          style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
        ),
      ],
    );
  }

  Widget _buildSubmit() {
    final l10n = context.l10n;
    final r = _readiness;
    final missing = ((r?['missing'] as List?) ?? []).cast<String>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.teacher.submitTitle'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('mobile.teacher.submitHint'),
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 16),
        _RequirementChip(label: l10n.t('mobile.teacher.checklistTitle'), done: r?['hasTitle'] == true),
        _RequirementChip(label: l10n.t('mobile.teacher.checklistCover'), done: r?['hasCover'] == true),
        _RequirementChip(
          label: l10n.t('mobile.teacher.sampleAccessChecklist', {
            'videos': '${r?['freeVideos'] ?? 0}',
            'minutes': '${(((r?['timedFreeSec'] as num?) ?? 0) / 60).floor()}',
          }),
          done: r?['hasSampleAccess'] == true ||
              ((r?['freeVideos'] as num?) ?? 0) >= 2 ||
              ((r?['timedFreeSec'] as num?) ?? 0) >= 120,
        ),
        _RequirementChip(
          label: l10n.t('mobile.teacher.quizzesHint', {
            'count': '${r?['quizzes'] ?? 0}',
          }),
          done: ((r?['quizzes'] as num?) ?? 0) >= 2,
        ),
        _RequirementChip(
          label: l10n.t('mobile.teacher.documentCountHint', {
            'count': '${r?['documents'] ?? 0}',
          }),
          done: ((r?['documents'] as num?) ?? 0) >= 1,
        ),
        if (missing.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(
            l10n.t('mobile.teacher.stillMissing', {'items': missing.join('\n• ')}),
            style: const TextStyle(color: Colors.orangeAccent, height: 1.5),
          ),
        ],
      ],
    );
  }
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({required this.steps, required this.current});

  final List<String> steps;
  final int current;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Row(
        children: [
          for (var i = 0; i < steps.length; i++) ...[
            if (i > 0) Expanded(child: Container(height: 2, color: i <= current ? AppTheme.accent : AppTheme.cardBorder)),
            CircleAvatar(
              radius: 14,
              backgroundColor: i <= current ? AppTheme.accent : AppTheme.cardBorder,
              child: Text(
                '${i + 1}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: i <= current ? Colors.black : AppTheme.muted,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _RequirementChip extends StatelessWidget {
  const _RequirementChip({required this.label, required this.done});

  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            done ? Icons.check_circle : Icons.radio_button_unchecked,
            color: done ? Colors.greenAccent : AppTheme.muted,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(color: done ? Colors.white : AppTheme.muted)),
        ],
      ),
    );
  }
}

class _WizardQuizQ {
  final textCtrl = TextEditingController();
  final optA = TextEditingController();
  final optB = TextEditingController();
  final optC = TextEditingController();
  final optD = TextEditingController();
  String correct = 'A';

  void dispose() {
    textCtrl.dispose();
    optA.dispose();
    optB.dispose();
    optC.dispose();
    optD.dispose();
  }

  Map<String, dynamic>? toPayload() {
    if (textCtrl.text.trim().isEmpty) return null;
    if (optA.text.trim().isEmpty || optB.text.trim().isEmpty) return null;
    return {
      'textEn': textCtrl.text.trim(),
      'options': {
        'A': optA.text.trim(),
        'B': optB.text.trim(),
        if (optC.text.trim().isNotEmpty) 'C': optC.text.trim(),
        if (optD.text.trim().isNotEmpty) 'D': optD.text.trim(),
      },
      'correctKey': correct,
    };
  }
}
