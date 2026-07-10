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
import 'package:ulearn/features/store/teacher_course_wizard_screen.dart';

/// Teacher: edit course metadata, reorder/rename/replace lessons, quizzes, documents.
class TeacherCourseManageScreen extends StatefulWidget {
  const TeacherCourseManageScreen({super.key, required this.courseId});

  final String courseId;

  @override
  State<TeacherCourseManageScreen> createState() => _TeacherCourseManageScreenState();
}

class _TeacherCourseManageScreenState extends State<TeacherCourseManageScreen> {
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _readiness;
  bool _loading = true;
  bool _saving = false;
  bool _busy = false;

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _lessons =>
      ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _quizzes =>
      ((_course?['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _documents =>
      ((_course?['materials'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  String get _status => _course?['status']?.toString() ?? '';

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/teacher/courses/${widget.courseId}');
      if (!mounted) return;
      final course = data['course'] as Map<String, dynamic>;
      _titleCtrl.text = course['titleEn']?.toString() ?? '';
      _descCtrl.text = course['description']?.toString() ?? '';
      _priceCtrl.text = (course['price'] as num?)?.toString() ?? '0';

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
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().patch('/api/teacher/courses/${widget.courseId}', {
        'titleEn': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'price': double.tryParse(_priceCtrl.text.trim()) ?? 0,
      });
      _toast(context.l10n.t('mobile.teacher.courseUpdated'));
      _load();
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _submitForReview() async {
    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/${widget.courseId}/submit', {});
      _toast('Submitted for review');
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
        title: const Text('Rename video'),
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
        title: const Text('Rename quiz'),
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

  Future<void> _renameDocument(Map<String, dynamic> doc) async {
    final ctrl = TextEditingController(text: doc['title']?.toString() ?? '');
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename document'),
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
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final source = File(pick.files.first.path!);

    setState(() => _busy = true);
    try {
      final api = context.read<ApiClient>();
      final upload = VideoUploadService(api);
      final wm = await upload.fetchWatermarkConfig(
        courseName: _titleCtrl.text.trim(),
      );
      final processed = await VideoProcessService.processForUpload(
        source: source,
        watermark: wm,
      );
      final duration = await VideoCoverHelper.videoDurationSec(processed.file.path);
      final result = await upload.uploadCourseVideo(
        file: processed.file,
        courseId: widget.courseId,
        scope: 'STORE_COURSE',
        durationSec: duration,
      );
      await api.patch(
        '/api/teacher/courses/${widget.courseId}/lessons/${lesson['id']}',
        {
          'fileKey': result.objectKey,
          'videoAssetId': result.videoId,
          if (duration != null) 'durationSec': duration,
        },
      );
      _toast('Video replaced');
      _load();
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
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

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.t('mobile.teacher.manageCourse')),
        actions: [
          if (_status == 'DRAFT')
            IconButton(
              tooltip: 'Continue wizard',
              icon: const Icon(Icons.auto_awesome),
              onPressed: () async {
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
                      padding: const EdgeInsets.all(20),
                      children: [
                        if (_status == 'REJECTED' && (_course!['reviewNotes']?.toString().isNotEmpty ?? false))
                          _Banner(
                            color: Colors.redAccent,
                            icon: Icons.info_outline,
                            text: 'Rejected: ${_course!['reviewNotes']}',
                          ),
                        if (_status == 'DRAFT')
                          _Banner(
                            color: Colors.orangeAccent,
                            icon: Icons.edit_note,
                            text: ready
                                ? 'Draft ready — submit for admin review.'
                                : 'Draft in progress. Finish required steps, then submit.',
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
                        FilledButton(
                          onPressed: _saving ? null : _saveCourse,
                          child: Text(_saving ? l10n.t('student.issuing') : l10n.t('common.save')),
                        ),
                        if (canSubmit) ...[
                          const SizedBox(height: 10),
                          FilledButton.tonal(
                            onPressed: _busy || !ready ? null : _submitForReview,
                            child: Text(ready ? 'Submit for review' : 'Complete checklist to submit'),
                          ),
                        ],
                        const SizedBox(height: 28),
                        Text(l10n.t('mobile.teacher.lessonsSection'),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 6),
                        const Text(
                          'Drag to reorder. Interview stays first.',
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
                            return Card(
                              key: ValueKey(lesson['id']),
                              margin: const EdgeInsets.only(bottom: 10),
                              child: ListTile(
                                leading: Icon(
                                  interview ? Icons.mic_rounded : Icons.drag_handle,
                                  color: AppTheme.accent,
                                ),
                                title: Text(lesson['title']?.toString() ?? ''),
                                subtitle: Text([
                                  if (interview) 'Interview',
                                  if (free && !interview) 'Free preview',
                                  if (!free) 'Paid lesson',
                                ].join(' · ')),
                                trailing: PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'rename') _renameLesson(lesson);
                                    if (v == 'replace') _replaceVideo(lesson);
                                    if (v == 'pdf') _editLessonPdf(lesson);
                                    if (v == 'delete') _deleteLesson(lesson['id'].toString());
                                  },
                                  itemBuilder: (_) => const [
                                    PopupMenuItem(value: 'rename', child: Text('Rename')),
                                    PopupMenuItem(value: 'replace', child: Text('Replace video')),
                                    PopupMenuItem(value: 'pdf', child: Text('Edit / attach PDF')),
                                    PopupMenuItem(
                                      value: 'delete',
                                      child: Text('Delete', style: TextStyle(color: Colors.redAccent)),
                                    ),
                                  ],
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
                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              title: Text(quiz['titleEn']?.toString() ?? ''),
                              subtitle: Text('$qCount ${l10n.t('quiz.questions').toLowerCase()}'),
                              trailing: PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'rename') _renameQuiz(quiz);
                                  if (v == 'delete') _deleteQuiz(quiz['id'].toString());
                                },
                                itemBuilder: (_) => const [
                                  PopupMenuItem(value: 'rename', child: Text('Rename')),
                                  PopupMenuItem(
                                    value: 'delete',
                                    child: Text('Delete', style: TextStyle(color: Colors.redAccent)),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }),
                        const SizedBox(height: 20),
                        const Text('Documents',
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 10),
                        ..._documents.map(
                          (doc) => Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              leading: const Icon(Icons.picture_as_pdf, color: AppTheme.accent),
                              title: Text(doc['title']?.toString() ?? 'Document'),
                              trailing: IconButton(
                                icon: const Icon(Icons.edit_outlined),
                                onPressed: () => _renameDocument(doc),
                              ),
                            ),
                          ),
                        ),
                        if (_documents.isEmpty)
                          const Text('No course documents yet.',
                              style: TextStyle(color: AppTheme.muted)),
                      ],
                    ),
                    if (_busy)
                      const Positioned.fill(
                        child: ColoredBox(
                          color: Colors.black54,
                          child: Center(child: CircularProgressIndicator(color: AppTheme.accent)),
                        ),
                      ),
                  ],
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
