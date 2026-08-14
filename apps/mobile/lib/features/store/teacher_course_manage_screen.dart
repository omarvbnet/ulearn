import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

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
import 'package:ulearn/features/store/teacher_course_wizard_screen.dart';
import 'package:ulearn/features/store/teacher_lesson_upload_screen.dart';
import 'package:ulearn/features/store/widgets/free_minute_picker.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_studio_screen.dart';

/// Teacher: edit course metadata, reorder/rename/replace lessons, quizzes, documents.
class TeacherCourseManageScreen extends StatefulWidget {
  const TeacherCourseManageScreen({
    super.key,
    required this.courseId,
    this.whiteboardLessonsEnabled = true,
  });

  final String courseId;
  final bool whiteboardLessonsEnabled;

  @override
  State<TeacherCourseManageScreen> createState() => _TeacherCourseManageScreenState();
}

class _TeacherCourseManageScreenState extends State<TeacherCourseManageScreen> {
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _readiness;
  bool _loading = true;
  bool _saving = false;
  bool _busy = false;
  String? _busyLabel;
  double? _busyProgress;
  Timer? _busyUiTimer;
  File? _pendingCover;
  String? _coverUrl;

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();

  @override
  void dispose() {
    _busyUiTimer?.cancel();
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

  void _setBusyUi(String label, {double? progress, bool force = false}) {
    if (!mounted) return;
    _busy = true;
    _busyLabel = label;
    if (progress != null) _busyProgress = progress.clamp(0.0, 1.0);
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

  List<Map<String, dynamic>> get _lessons =>
      ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _quizzes =>
      ((_course?['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _documents =>
      ((_course?['materials'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  String get _status => _course?['status']?.toString() ?? '';

  int get _freeCount =>
      _lessons.where((l) => l['isFreePreview'] == true).length;

  bool get _usesSections => _course?['usesSections'] == true;

  List<Map<String, dynamic>> get _sections =>
      ((_course?['sections'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  Future<String?> _promptText({
    required String title,
    String? initial,
    required String label,
  }) async {
    final ctrl = TextEditingController(text: initial ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(context.l10n.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: Text(context.l10n.save),
          ),
        ],
      ),
    );
    ctrl.dispose();
    return value;
  }

  Future<void> _addSection() async {
    final l10n = context.l10n;
    final title = await _promptText(
      title: l10n.t('mobile.teacher.addSection'),
      label: l10n.t('mobile.teacher.sectionTitle'),
    );
    if (title == null || title.isEmpty || !mounted) return;
    try {
      await context.read<ApiClient>().post(
        '/api/teacher/courses/${widget.courseId}/sections',
        {'title': title},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.t('mobile.teacher.sectionAdded'))),
        );
      }
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _renameSection(Map<String, dynamic> section) async {
    final l10n = context.l10n;
    final title = await _promptText(
      title: l10n.t('mobile.teacher.renameSection'),
      initial: section['title']?.toString(),
      label: l10n.t('mobile.teacher.sectionTitle'),
    );
    if (title == null || title.isEmpty || !mounted) return;
    try {
      await context.read<ApiClient>().patch(
        '/api/teacher/courses/${widget.courseId}/sections/${section['id']}',
        {'title': title},
      );
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _deleteSection(Map<String, dynamic> section) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.t('mobile.teacher.removeSection')),
        content: Text(l10n.t('mobile.teacher.removeSectionConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.cancel)),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.t('common.delete'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ApiClient>().delete(
        '/api/teacher/courses/${widget.courseId}/sections/${section['id']}',
      );
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.t('mobile.teacher.sectionNotEmpty'))),
        );
      }
    }
  }

  Future<String?> _pickSectionId() async {
    if (!_usesSections) return null;
    if (_sections.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.teacher.sectionRequired'))),
      );
      return null;
    }
    if (_sections.length == 1) return _sections.first['id']?.toString();
    return showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: Text(context.l10n.t('mobile.teacher.chooseSection'))),
            for (final s in _sections)
              ListTile(
                title: Text(s['title']?.toString() ?? ''),
                onTap: () => Navigator.pop(ctx, s['id']?.toString()),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _addLessonToSection() async {
    final l10n = context.l10n;
    final sectionId = await _pickSectionId();
    if (_usesSections && sectionId == null) return;
    if (!mounted) return;
    final title = _titleCtrl.text.trim().isEmpty
        ? l10n.t('mobile.teacher.manageCourse')
        : _titleCtrl.text.trim();
    String? choice = 'VIDEO';
    if (widget.whiteboardLessonsEnabled) {
      choice = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.videocam_outlined),
                title: const Text('Video Lesson'),
                onTap: () => Navigator.pop(ctx, 'VIDEO'),
              ),
              ListTile(
                leading: const Icon(Icons.draw_outlined),
                title: const Text('Whiteboard Lesson'),
                onTap: () => Navigator.pop(ctx, 'WHITEBOARD'),
              ),
            ],
          ),
        ),
      );
    }
    if (choice == null || !mounted) return;
    if (choice == 'WHITEBOARD') {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => WhiteboardStudioScreen(
            courseId: widget.courseId,
            courseTitle: title,
            sectionId: sectionId,
          ),
        ),
      );
    } else {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => TeacherLessonUploadScreen(
            courseId: widget.courseId,
            courseTitle: title,
            sectionId: sectionId,
          ),
        ),
      );
    }
    _load();
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/teacher/courses/${widget.courseId}');
      if (!mounted) return;
      final course = data['course'] as Map<String, dynamic>;
      _titleCtrl.text = course['titleEn']?.toString() ?? '';
      _descCtrl.text = course['description']?.toString() ?? '';
      _priceCtrl.text = (course['price'] as num?)?.toString() ?? '0';
      _coverUrl = course['thumbnail']?.toString();
      _pendingCover = null;

      Map<String, dynamic>? readiness;
      try {
        final r = await api.get('/api/teacher/courses/${widget.courseId}/readiness');
        readiness = r['readiness'] as Map<String, dynamic>?;
      } catch (_) {}

      setState(() {
        _course = course;
        _readiness = readiness;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _saveCourse() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _saving = true);
    try {
      final api = context.read<ApiClient>();
      String? thumbnail = _coverUrl;

      if (_pendingCover != null) {
        final size = await _pendingCover!.length();
        final ext = _pendingCover!.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        final presign = await api.post('/api/admin/uploads', {
          'filename': 'course_cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
          'contentType': ext == 'png' ? 'image/png' : 'image/jpeg',
          'size': size,
          'category': 'image',
          'folder': 'teacher-covers',
        });
        final uploadUrl = presign['uploadUrl']?.toString();
        final publicUrl = presign['publicUrl']?.toString();
        if (uploadUrl == null || publicUrl == null) {
          throw Exception(context.l10n.t('mobile.teacher.coverUploadFailed'));
        }
        await api.putFile(
          uploadUrl,
          _pendingCover!,
          ext == 'png' ? 'image/png' : 'image/jpeg',
        );
        thumbnail = publicUrl;
      }

      await api.patch('/api/teacher/courses/${widget.courseId}', {
        'titleEn': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'price': double.tryParse(_priceCtrl.text.trim()) ?? 0,
        if (thumbnail != null && thumbnail.isNotEmpty) 'thumbnail': thumbnail,
      });
      if (thumbnail != null && thumbnail.isNotEmpty) {
        await evictCachedImage(_coverUrl);
        await evictCachedImage(thumbnail);
      }
      if (mounted) {
        setState(() {
          _coverUrl = thumbnail;
          _pendingCover = null;
        });
      }
      _toast(context.l10n.t('mobile.teacher.courseUpdated'));
      _load();
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickCourseCover() async {
    final cover = await VideoCoverHelper.pickCoverImage();
    if (cover != null && mounted) {
      setState(() => _pendingCover = cover);
    }
  }

  Future<void> _setFreeMinutes(Map<String, dynamic> lesson) async {
    final l10n = context.l10n;
    final duration = (lesson['durationSec'] as num?)?.toInt() ?? 600;
    var value = (lesson['freePreviewSec'] as num?)?.toInt() ?? 120;
    if (value <= 0) value = 120;

    final result = await showModalBottomSheet<int?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModal) {
            return Padding(
              padding: EdgeInsets.fromLTRB(
                20,
                16,
                20,
                20 + MediaQuery.paddingOf(ctx).bottom,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.t('mobile.teacher.setFreeMinutes'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 14),
                  FreeMinutePicker(
                    durationSec: duration,
                    valueSec: value,
                    onChanged: (v) => setModal(() => value = v),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, 0),
                        child: Text(l10n.t('mobile.teacher.clearFreeMinutes')),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: () => Navigator.pop(ctx, value),
                        child: Text(l10n.t('common.save')),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
    if (result == null || !mounted) return;
    try {
      await context.read<ApiClient>().patch(
        '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
        {
          'isFreePreview': false,
          'freePreviewSec': result > 0 ? result : null,
        },
      );
      _toast(l10n.t('mobile.teacher.freeMinutesSaved'));
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (e) {
      _toast(e.toString());
    }
  }

  Future<void> _toggleLessonAccess(Map<String, dynamic> lesson, {required bool makeFree}) async {
    final l10n = context.l10n;
    final interview = lesson['isInterview'] == true;
    final currentlyFree = lesson['isFreePreview'] == true;

    if (interview && !makeFree) {
      _toast(l10n.t('mobile.teacher.interviewMustStayFree'));
      return;
    }
    if (makeFree == currentlyFree) return;

    if (!makeFree && currentlyFree && _freeCount <= 2) {
      _toast(l10n.t('mobile.teacher.minFreePreviews'));
      return;
    }
    if (makeFree && !currentlyFree && _freeCount >= 2) {
      _toast(l10n.t('mobile.teacher.maxFreePreviews'));
      return;
    }

    try {
      await context.read<ApiClient>().patch(
        '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
        {
          'isFreePreview': makeFree,
          if (makeFree) 'freePreviewSec': null,
        },
      );
      _toast(
        makeFree
            ? l10n.t('mobile.teacher.markedFree')
            : l10n.t('mobile.teacher.markedPaid'),
      );
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (e) {
      _toast(e.toString());
    }
  }

  Future<void> _submitForReview() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/${widget.courseId}/submit', {});
      _toast(context.l10n.t('mobile.teacher.submittedForReview'));
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reorder(int oldIndex, int newIndex) async {
    final lessons = [..._lessons];
    if (newIndex > oldIndex) newIndex -= 1;
    final item = lessons.removeAt(oldIndex);
    // Keep interview first
    if (item['isInterview'] == true) {
      lessons.insert(0, item);
    } else {
      lessons.insert(newIndex.clamp(0, lessons.length), item);
      final interviewIdx = lessons.indexWhere((l) => l['isInterview'] == true);
      if (interviewIdx > 0) {
        final interview = lessons.removeAt(interviewIdx);
        lessons.insert(0, interview);
      }
    }
    setState(() {
      _course = {...?_course, 'lessons': lessons};
    });
    try {
      await context.read<ApiClient>().patch(
        '/api/teacher/courses/${widget.courseId}/lessons/reorder',
        {'lessonIds': lessons.map((l) => l['id'].toString()).toList()},
      );
    } catch (e) {
      _toast(e.toString());
      _load();
    }
  }

  Future<void> _renameLesson(Map<String, dynamic> lesson) async {
    final ctrl = TextEditingController(text: lesson['title']?.toString() ?? '');
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.t('mobile.teacher.renameVideo')),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(context.l10n.cancel)),
          TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: Text(context.l10n.t('common.save'))),
        ],
      ),
    );
    if (title == null || title.isEmpty || !mounted) return;
    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
      {'title': title},
    );
    _load();
  }

  Future<void> _renameQuiz(Map<String, dynamic> quiz) async {
    final ctrl = TextEditingController(text: quiz['titleEn']?.toString() ?? '');
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.t('mobile.teacher.renameQuiz')),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(context.l10n.cancel)),
          TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: Text(context.l10n.t('common.save'))),
        ],
      ),
    );
    if (title == null || title.isEmpty || !mounted) return;
    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/quizzes/${quiz['id']}',
      {'titleEn': title},
    );
    _load();
  }

  String _lessonTitleById(String? id) {
    if (id == null || id.isEmpty) return context.l10n.studioAtEndOfCourse;
    for (final l in _lessons) {
      if (l['id']?.toString() == id) {
        return l['title']?.toString() ?? context.l10n.t('student.videos');
      }
    }
    return context.l10n.studioAtEndOfCourse;
  }

  Future<String?> _pickAfterLesson({String? currentId, required bool allowCourseLevel}) async {
    final l10n = context.l10n;
    return showModalBottomSheet<String?>(
      context: context,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.symmetric(vertical: 12),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Text(
                  l10n.t('mobile.teacher.placeAfterVideo'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                ),
              ),
              if (allowCourseLevel)
                ListTile(
                  leading: Icon(
                    currentId == null ? Icons.check_circle : Icons.radio_button_unchecked,
                    color: AppTheme.accent,
                  ),
                  title: Text(l10n.studioAtEndOfCourse),
                  subtitle: Text(l10n.t('mobile.teacher.placeOptionalHint')),
                  onTap: () => Navigator.pop(ctx, ''),
                ),
              ..._lessons.map((l) {
                final id = l['id']?.toString() ?? '';
                final selected = currentId == id;
                return ListTile(
                  leading: Icon(
                    selected ? Icons.check_circle : Icons.radio_button_unchecked,
                    color: AppTheme.accent,
                  ),
                  title: Text(l['title']?.toString() ?? l10n.t('student.videos')),
                  onTap: () => Navigator.pop(ctx, id),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  Future<void> _alignQuiz(Map<String, dynamic> quiz) async {
    final current = quiz['afterLessonId']?.toString();
    final picked = await _pickAfterLesson(currentId: current, allowCourseLevel: true);
    if (picked == null || !mounted) return;
    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/quizzes/${quiz['id']}',
      {'afterLessonId': picked.isEmpty ? null : picked},
    );
    _toast(context.l10n.t('mobile.teacher.alignmentSaved'));
    _load();
  }

  Future<void> _alignDocument(Map<String, dynamic> doc) async {
    final current = doc['lessonId']?.toString();
    final picked = await _pickAfterLesson(currentId: current, allowCourseLevel: true);
    if (picked == null || !mounted) return;
    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/documents',
      {
        'documentId': doc['id'],
        'lessonId': picked.isEmpty ? null : picked,
      },
    );
    _toast(context.l10n.t('mobile.teacher.alignmentSaved'));
    _load();
  }

  Future<void> _renameDocument(Map<String, dynamic> doc) async {
    final ctrl = TextEditingController(text: doc['title']?.toString() ?? '');
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.t('mobile.teacher.renameDocument')),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(context.l10n.cancel)),
          TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: Text(context.l10n.t('common.save'))),
        ],
      ),
    );
    if (title == null || title.isEmpty || !mounted) return;
    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/documents',
      {'documentId': doc['id'], 'title': title},
    );
    _load();
  }

  Future<void> _replaceVideo(Map<String, dynamic> lesson) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final source = File(pick.files.first.path!);
    final l10n = context.l10n;

    String formatBytes(int bytes) {
      if (bytes < 1024) return '$bytes B';
      if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }

    _setBusyUi(l10n.t('mobile.teacher.processingVideo'), progress: 0.02, force: true);
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
        courseId: widget.courseId,
        scope: 'STORE_COURSE',
        durationSec: duration,
        watermarkApplied: false,
        onProgress: (sent, total) {
          if (total <= 0) return;
          final pct = (sent * 100 / total).round();
          _setBusyUi(
            l10n.t('mobile.teacher.uploadingProgress', {
              'sent': formatBytes(sent),
              'total': formatBytes(total),
              'percent': '$pct',
            }),
            progress: 0.55 + (sent / total) * 0.45,
          );
        },
      );
      _setBusyUi(l10n.t('mobile.teacher.saving'), progress: 0.98, force: true);
      await api.patch(
        '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
        {
          'fileKey': result.objectKey,
          'videoAssetId': result.videoId,
          if (duration != null) 'durationSec': duration,
        },
      );
      _toast(l10n.t('mobile.teacher.videoReplaced'));
      _load();
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

  Future<void> _deleteLesson(String lessonId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.l10n.t('mobile.teacher.removeLesson')),
        content: Text(context.l10n.t('mobile.teacher.removeLessonConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(context.l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(context.l10n.t('common.delete'), style: const TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await context.read<ApiClient>().delete(
      '/api/teacher/courses/${widget.courseId}/lessons',
      {'lessonId': lessonId},
    );
    _load();
  }

  Future<void> _deleteQuiz(String quizId) async {
    await context.read<ApiClient>().delete(
      '/api/teacher/courses/${widget.courseId}/quizzes',
      {'quizId': quizId},
    );
    _load();
  }

  Future<void> _editLessonPdf(Map<String, dynamic> lesson) async {
    final l10n = context.l10n;
    final titleCtrl = TextEditingController(text: lesson['title']?.toString() ?? '');
    File? pdfFile;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.paddingOf(context).bottom + 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l10n.t('mobile.teacher.editLesson'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
              const SizedBox(height: 14),
              TextField(
                controller: titleCtrl,
                decoration: InputDecoration(labelText: l10n.t('mobile.teacher.lessonTitle')),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final pick = await FilePicker.pickFiles(
                    type: FileType.custom,
                    allowedExtensions: const ['pdf'],
                  );
                  if (pick != null && pick.files.isNotEmpty && pick.files.first.path != null) {
                    setSheet(() => pdfFile = File(pick.files.first.path!));
                  }
                },
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: Text(
                  pdfFile != null
                      ? pdfFile!.path.split(Platform.pathSeparator).last
                      : l10n.t('mobile.teacher.attachPdfOptional'),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(l10n.t('common.save')),
              ),
            ],
          ),
        ),
      ),
    );

    if (saved != true || !mounted) {
      titleCtrl.dispose();
      return;
    }

    final payload = <String, dynamic>{'title': titleCtrl.text.trim()};
    if (pdfFile != null) {
      final bytes = await pdfFile!.readAsBytes();
      final api = context.read<ApiClient>();
      final presign = await api.post('/api/admin/uploads', {
        'filename': pdfFile!.path.split(Platform.pathSeparator).last,
        'contentType': 'application/pdf',
        'size': bytes.length,
        'category': 'document',
        'folder': 'teacher-course-pdfs',
      });
      final uploadUrl = presign['uploadUrl']?.toString();
      final key = presign['key']?.toString();
      final publicUrl = presign['publicUrl']?.toString();
      if (uploadUrl != null && key != null) {
        await api.putBytes(uploadUrl, Uint8List.fromList(bytes), 'application/pdf');
        payload['pdfFileKey'] = key;
        payload['pdfFileUrl'] = publicUrl ?? uploadUrl;
        payload['pdfMimeType'] = 'application/pdf';
        payload['pdfFileSize'] = bytes.length;
        payload['pdfTitle'] = '${titleCtrl.text.trim()} — PDF';
      }
    }

    await context.read<ApiClient>().patch(
      '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
      payload,
    );
    titleCtrl.dispose();
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final canSubmit = _status == 'DRAFT' || _status == 'REJECTED';
    final ready = _readiness?['ready'] == true;

    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: Scaffold(
      appBar: GlassAppBar(
        title: Text(l10n.t('mobile.teacher.manageCourse')),
        actions: [
          if (_status == 'DRAFT')
            IconButton(
              tooltip: l10n.t('mobile.teacher.continueWizard'),
              icon: const Icon(Icons.auto_awesome),
              onPressed: () async {
                FocusManager.instance.primaryFocus?.unfocus();
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => TeacherCourseWizardScreen(courseId: widget.courseId),
                  ),
                );
                _load();
              },
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _course == null
              ? Center(child: Text(l10n.t('mobile.error.generic')))
              : Stack(
                  children: [
                    ListView(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.all(20),
                      children: [
                        if (_status == 'REJECTED' && (_course!['reviewNotes']?.toString().isNotEmpty ?? false))
                          _Banner(
                            color: Colors.redAccent,
                            icon: Icons.info_outline,
                            text: l10n.t('mobile.teacher.rejectedBanner', {
                              'notes': _course!['reviewNotes'].toString(),
                            }),
                          ),
                        if (_status == 'DRAFT')
                          _Banner(
                            color: Colors.orangeAccent,
                            icon: Icons.edit_note,
                            text: ready
                                ? l10n.t('mobile.teacher.draftReady')
                                : l10n.t('mobile.teacher.draftInProgress'),
                          ),
                        Text(l10n.t('mobile.teacher.courseDetails'),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _titleCtrl,
                          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.courseTitle')),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _descCtrl,
                          maxLines: 3,
                          decoration:
                              InputDecoration(labelText: l10n.t('mobile.teacher.courseDescription')),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _priceCtrl,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(labelText: l10n.t('mobile.teacher.coursePrice')),
                        ),
                        const SizedBox(height: 16),
                        Text(l10n.t('mobile.teacher.courseCover'),
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                        const SizedBox(height: 8),
                        GestureDetector(
                          onTap: _pickCourseCover,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              height: 160,
                              decoration: BoxDecoration(
                                border: Border.all(color: AppTheme.cardBorder),
                                color: AppTheme.card,
                              ),
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  if (_pendingCover != null)
                                    Image.file(_pendingCover!, fit: BoxFit.cover)
                                  else if (_coverUrl != null && _coverUrl!.isNotEmpty)
                                    CachedImage(url: _coverUrl!, fit: BoxFit.cover)
                                  else
                                    Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Icon(Icons.add_photo_alternate_outlined,
                                            size: 36, color: AppTheme.muted),
                                        const SizedBox(height: 8),
                                        Text(
                                          l10n.t('mobile.teacher.tapToChangeCover'),
                                          style: TextStyle(color: AppTheme.muted),
                                        ),
                                      ],
                                    ),
                                  if (_pendingCover != null ||
                                      (_coverUrl != null && _coverUrl!.isNotEmpty))
                                    Align(
                                      alignment: Alignment.bottomRight,
                                      child: Padding(
                                        padding: const EdgeInsets.all(10),
                                        child: Chip(
                                          label: Text(l10n.t('mobile.teacher.changeCover')),
                                          backgroundColor: Colors.black54,
                                          labelStyle: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _saving ? null : _saveCourse,
                          child: Text(_saving ? l10n.t('student.issuing') : l10n.t('common.save')),
                        ),
                        if (canSubmit) ...[
                          const SizedBox(height: 10),
                          FilledButton.tonal(
                            onPressed: _busy || !ready ? null : _submitForReview,
                            child: Text(
                              ready
                                  ? l10n.t('mobile.teacher.submitForReview')
                                  : l10n.t('mobile.teacher.completeChecklist'),
                            ),
                          ),
                        ],
                        const SizedBox(height: 28),
                        if (_usesSections) ...[
                          Text(l10n.t('mobile.teacher.sectionsSection'),
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                          const SizedBox(height: 6),
                          Text(
                            l10n.t('mobile.teacher.sectionRequired'),
                            style: TextStyle(color: AppTheme.muted, fontSize: 12),
                          ),
                          const SizedBox(height: 10),
                          FilledButton.tonalIcon(
                            onPressed: _addSection,
                            icon: const Icon(Icons.create_new_folder_outlined),
                            label: Text(l10n.t('mobile.teacher.addSection')),
                          ),
                          const SizedBox(height: 10),
                          if (_sections.isEmpty)
                            Text(
                              l10n.t('mobile.teacher.noSectionsYet'),
                              style: TextStyle(color: AppTheme.muted),
                            ),
                          for (final section in _sections)
                            Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: ListTile(
                                leading: const Icon(Icons.folder_open_rounded, color: AppTheme.accent),
                                title: Text(section['title']?.toString() ?? ''),
                                subtitle: Text(
                                  l10n.t('mobile.studio.lessonsCount', {
                                    'count': '${_lessons.where((l) => l['sectionId']?.toString() == section['id']?.toString()).length}',
                                  }),
                                ),
                                trailing: PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'rename') _renameSection(section);
                                    if (v == 'delete') _deleteSection(section);
                                  },
                                  itemBuilder: (_) => [
                                    PopupMenuItem(
                                      value: 'rename',
                                      child: Text(l10n.t('mobile.teacher.renameSection')),
                                    ),
                                    PopupMenuItem(
                                      value: 'delete',
                                      child: Text(l10n.t('mobile.teacher.removeSection')),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          const SizedBox(height: 20),
                        ],
                        Text(l10n.t('mobile.teacher.lessonsSection'),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 6),
                        Text(
                          l10n.t('mobile.teacher.reorderHint'),
                          style: TextStyle(color: AppTheme.muted, fontSize: 12),
                        ),
                        const SizedBox(height: 10),
                        FilledButton.tonalIcon(
                          onPressed: _addLessonToSection,
                          icon: const Icon(Icons.upload_rounded),
                          label: Text(l10n.t('mobile.studio.addVideo')),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.t('mobile.teacher.freePaidHint', {
                            'count': '$_freeCount',
                          }),
                          style: TextStyle(color: AppTheme.muted, fontSize: 12),
                        ),
                        const SizedBox(height: 10),
                        ReorderableListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _lessons.length,
                          onReorder: _reorder,
                          itemBuilder: (context, index) {
                            final lesson = _lessons[index];
                            final interview = lesson['isInterview'] == true;
                            final free = lesson['isFreePreview'] == true;
                            final freeSec = (lesson['freePreviewSec'] as num?)?.toInt() ?? 0;
                            return Card(
                              key: ValueKey(lesson['id']),
                              margin: const EdgeInsets.only(bottom: 10),
                              child: ListTile(
                                leading: Icon(
                                  interview ? Icons.mic_rounded : Icons.drag_handle,
                                  color: AppTheme.accent,
                                ),
                                title: Text(lesson['title']?.toString() ?? ''),
                                subtitle: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text([
                                      if (interview) l10n.t('mobile.teacher.interviewBadge'),
                                      if (free && !interview)
                                        l10n.t('mobile.teacher.freePreviewBadge'),
                                      if (!free && freeSec > 0)
                                        l10n.t('mobile.teacher.timedFreeBadge', {
                                          'minutes': '${(freeSec / 60).ceil()}',
                                        }),
                                      if (!free && freeSec <= 0)
                                        l10n.t('mobile.teacher.paidLessonBadge'),
                                    ].join(' · ')),
                                    if (!interview) ...[
                                      const SizedBox(height: 8),
                                      SegmentedButton<bool>(
                                        style: const ButtonStyle(
                                          visualDensity: VisualDensity.compact,
                                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        ),
                                        segments: [
                                          ButtonSegment(
                                            value: true,
                                            label: Text(l10n.t('mobile.teacher.markFree')),
                                            icon: const Icon(Icons.lock_open, size: 14),
                                          ),
                                          ButtonSegment(
                                            value: false,
                                            label: Text(l10n.t('mobile.teacher.markPaid')),
                                            icon: const Icon(Icons.lock_outline, size: 14),
                                          ),
                                        ],
                                        selected: {free},
                                        onSelectionChanged: (s) {
                                          _toggleLessonAccess(lesson, makeFree: s.first);
                                        },
                                      ),
                                    ],
                                  ],
                                ),
                                isThreeLine: !interview,
                                trailing: PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'rename') _renameLesson(lesson);
                                    if (v == 'replace') _replaceVideo(lesson);
                                    if (v == 'editBoard') {
                                      final wbId = lesson['whiteboardAssetId']?.toString() ??
                                          lesson['whiteboardId']?.toString();
                                      if (wbId == null || wbId.isEmpty) return;
                                      Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => WhiteboardStudioScreen(
                                            courseId: widget.courseId,
                                            courseTitle: _titleCtrl.text.trim().isEmpty
                                                ? widget.courseId
                                                : _titleCtrl.text.trim(),
                                            initialTitle: lesson['title']?.toString(),
                                            lessonId: lesson['id']?.toString(),
                                            whiteboardId: wbId,
                                          ),
                                        ),
                                      ).then((ok) {
                                        if (ok == true) _load();
                                      });
                                    }
                                    if (v == 'pdf') _editLessonPdf(lesson);
                                    if (v == 'minutes') _setFreeMinutes(lesson);
                                    if (v == 'delete') _deleteLesson(lesson['id'].toString());
                                  },
                                  itemBuilder: (_) {
                                    final isBoard =
                                        lesson['lessonType']?.toString() == 'WHITEBOARD';
                                    return [
                                      PopupMenuItem(
                                        value: 'rename',
                                        child: Text(l10n.t('mobile.teacher.rename')),
                                      ),
                                      if (isBoard)
                                        const PopupMenuItem(
                                          value: 'editBoard',
                                          child: Text('Edit board'),
                                        )
                                      else
                                        PopupMenuItem(
                                          value: 'replace',
                                          child: Text(l10n.t('mobile.teacher.replaceVideo')),
                                        ),
                                      if (!interview)
                                        PopupMenuItem(
                                          value: 'minutes',
                                          child: Text(l10n.t('mobile.teacher.setFreeMinutes')),
                                        ),
                                      PopupMenuItem(
                                        value: 'pdf',
                                        child: Text(l10n.t('mobile.teacher.editAttachPdf')),
                                      ),
                                      PopupMenuItem(
                                        value: 'delete',
                                        child: Text(
                                          l10n.t('common.delete'),
                                          style: const TextStyle(color: Colors.redAccent),
                                        ),
                                      ),
                                    ];
                                  },
                                ),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 20),
                        Text(l10n.t('mobile.teacher.quizzesSection'),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 10),
                        ..._quizzes.map((quiz) {
                          final qCount = (quiz['_count'] as Map?)?['questions'] as num? ??
                              (quiz['questions'] as List?)?.length ??
                              0;
                          final afterId = quiz['afterLessonId']?.toString();
                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              title: Text(quiz['titleEn']?.toString() ?? ''),
                              subtitle: Text(
                                '$qCount ${l10n.t('quiz.questions').toLowerCase()}\n'
                                '${l10n.t('mobile.teacher.afterVideoLabel')}: ${_lessonTitleById(afterId)}',
                              ),
                              isThreeLine: true,
                              trailing: PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'rename') _renameQuiz(quiz);
                                  if (v == 'align') _alignQuiz(quiz);
                                  if (v == 'delete') _deleteQuiz(quiz['id'].toString());
                                },
                                itemBuilder: (_) => [
                                  PopupMenuItem(
                                    value: 'align',
                                    child: Text(l10n.t('mobile.teacher.placeAfterVideo')),
                                  ),
                                  PopupMenuItem(
                                    value: 'rename',
                                    child: Text(l10n.t('mobile.teacher.rename')),
                                  ),
                                  PopupMenuItem(
                                    value: 'delete',
                                    child: Text(
                                      l10n.t('common.delete'),
                                      style: const TextStyle(color: Colors.redAccent),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }),
                        const SizedBox(height: 20),
                        Text(l10n.t('mobile.teacher.documentsSection'),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 10),
                        ..._documents.map(
                          (doc) {
                            final lessonId = doc['lessonId']?.toString();
                            return Card(
                              margin: const EdgeInsets.only(bottom: 10),
                              child: ListTile(
                                leading: const Icon(Icons.picture_as_pdf, color: AppTheme.accent),
                                title: Text(
                                  doc['title']?.toString() ??
                                      l10n.t('mobile.teacher.documentFallback'),
                                ),
                                subtitle: Text(
                                  '${l10n.t('mobile.teacher.afterVideoLabel')}: '
                                  '${lessonId == null || lessonId.isEmpty ? l10n.t('mobile.teacher.courseLevelDoc') : _lessonTitleById(lessonId)}',
                                ),
                                trailing: PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'align') _alignDocument(doc);
                                    if (v == 'rename') _renameDocument(doc);
                                  },
                                  itemBuilder: (_) => [
                                    PopupMenuItem(
                                      value: 'align',
                                      child: Text(l10n.t('mobile.teacher.placeAfterVideo')),
                                    ),
                                    PopupMenuItem(
                                      value: 'rename',
                                      child: Text(l10n.t('mobile.teacher.rename')),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                        if (_documents.isEmpty)
                          Text(
                            l10n.t('mobile.teacher.noDocuments'),
                            style: TextStyle(color: AppTheme.muted),
                          ),
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
                                  ],
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
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.color, required this.icon, required this.text});

  final Color color;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13, height: 1.4))),
        ],
      ),
    );
  }
}
