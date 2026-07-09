import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Teacher: edit course metadata, lessons, and quizzes. No preview until approved.
class TeacherCourseManageScreen extends StatefulWidget {
  const TeacherCourseManageScreen({super.key, required this.courseId});

  final String courseId;

  @override
  State<TeacherCourseManageScreen> createState() => _TeacherCourseManageScreenState();
}

class _TeacherCourseManageScreenState extends State<TeacherCourseManageScreen> {
  Map<String, dynamic>? _course;
  bool _loading = true;
  bool _saving = false;

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

  Future<void> _load() async {
    try {
      final data =
          await context.read<ApiClient>().get('/api/teacher/courses/${widget.courseId}');
      if (!mounted) return;
      final course = data['course'] as Map<String, dynamic>;
      _titleCtrl.text = course['titleEn']?.toString() ?? '';
      _descCtrl.text = course['description']?.toString() ?? '';
      _priceCtrl.text = (course['price'] as num?)?.toString() ?? '0';
      setState(() {
        _course = course;
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

  Future<void> _saveCourse() async {
    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().patch('/api/teacher/courses/${widget.courseId}', {
        'titleEn': _titleCtrl.text.trim(),
        'description': _descCtrl.text.trim(),
        'price': double.tryParse(_priceCtrl.text.trim()) ?? 0,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.teacher.courseUpdated'))),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteLesson(String lessonId) async {
    final l10n = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.t('mobile.teacher.removeLesson')),
        content: Text(l10n.t('mobile.teacher.removeLessonConfirm')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.t('common.delete'), style: const TextStyle(color: Colors.redAccent)),
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

  Future<void> _editLesson(Map<String, dynamic> lesson) async {
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
                  if (pick != null && pick.files.isNotEmpty) {
                    final f = pick.files.first;
                    if (f.path != null) {
                      setSheet(() => pdfFile = File(f.path!));
                    }
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

    return Scaffold(
      appBar: AppBar(title: Text(l10n.t('mobile.teacher.manageCourse'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _course == null
              ? Center(child: Text(l10n.t('mobile.error.generic')))
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (_course!['canPreview'] != true)
                      Container(
                        margin: const EdgeInsets.only(bottom: 16),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.orangeAccent.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.orangeAccent.withValues(alpha: 0.35)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.visibility_off_outlined,
                                color: Colors.orangeAccent, size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                l10n.t('mobile.teacher.previewBlocked'),
                                style: const TextStyle(fontSize: 13, height: 1.4),
                              ),
                            ),
                          ],
                        ),
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
                    const SizedBox(height: 28),
                    Text(l10n.t('mobile.teacher.lessonsSection'),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 10),
                    ...((_course!['lessons'] as List<dynamic>?) ?? []).map((raw) {
                      final lesson = raw as Map<String, dynamic>;
                      final materials =
                          (lesson['materials'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
                              [];
                      final hasPdf = materials.any((m) => m['type'] == 'PDF');
                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: ListTile(
                          title: Text(lesson['title']?.toString() ?? ''),
                          subtitle: Text(
                            hasPdf
                                ? l10n.t('mobile.teacher.pdfAttached')
                                : l10n.t('mobile.teacher.noPdf'),
                            style: const TextStyle(fontSize: 12),
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'edit') _editLesson(lesson);
                              if (v == 'delete') _deleteLesson(lesson['id'].toString());
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(
                                value: 'edit',
                                child: Text(l10n.t('common.edit')),
                              ),
                              PopupMenuItem(
                                value: 'delete',
                                child: Text(l10n.t('common.delete'),
                                    style: const TextStyle(color: Colors.redAccent)),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                    const SizedBox(height: 20),
                    Text(l10n.t('mobile.teacher.quizzesSection'),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 10),
                    ...((_course!['quizzes'] as List<dynamic>?) ?? []).map((raw) {
                      final quiz = raw as Map<String, dynamic>;
                      final qCount =
                          (quiz['_count'] as Map?)?['questions'] as num? ?? quiz['questions']?.length ?? 0;
                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: ListTile(
                          title: Text(quiz['titleEn']?.toString() ?? ''),
                          subtitle: Text('$qCount ${l10n.t('quiz.questions').toLowerCase()}'),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                            onPressed: () => _deleteQuiz(quiz['id'].toString()),
                          ),
                        ),
                      );
                    }),
                  ],
                ),
    );
  }
}
