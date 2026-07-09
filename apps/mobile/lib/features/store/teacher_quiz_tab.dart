import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Teacher mobile tab: add a quiz after a specific course video.
class TeacherQuizTab extends StatefulWidget {
  const TeacherQuizTab({
    super.key,
    required this.courses,
    required this.courseId,
    required this.onCourseChanged,
  });

  final List<Map<String, dynamic>> courses;
  final String? courseId;
  final ValueChanged<String?> onCourseChanged;

  @override
  State<TeacherQuizTab> createState() => _TeacherQuizTabState();
}

class _TeacherQuizTabState extends State<TeacherQuizTab> {
  final _titleCtrl = TextEditingController();
  final _questionCtrl = TextEditingController();
  final _optA = TextEditingController();
  final _optB = TextEditingController();
  final _optC = TextEditingController();
  final _optD = TextEditingController();
  String _correct = 'A';
  String? _afterLessonId;
  bool _saving = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _questionCtrl.dispose();
    _optA.dispose();
    _optB.dispose();
    _optC.dispose();
    _optD.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _lessons {
    final course = widget.courses.cast<Map<String, dynamic>?>().firstWhere(
          (c) => c?['id']?.toString() == widget.courseId,
          orElse: () => null,
        );
    return ((course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
  }

  Future<void> _submit() async {
    final courseId = widget.courseId;
    if (courseId == null || _titleCtrl.text.trim().isEmpty) return;
    if (_questionCtrl.text.trim().isEmpty) return;
    if (_optA.text.trim().isEmpty || _optB.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioAddQuizMinOptions)),
      );
      return;
    }

    final options = <String, String>{
      'A': _optA.text.trim(),
      'B': _optB.text.trim(),
      if (_optC.text.trim().isNotEmpty) 'C': _optC.text.trim(),
      if (_optD.text.trim().isNotEmpty) 'D': _optD.text.trim(),
    };

    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/$courseId/quizzes', {
        'titleEn': _titleCtrl.text.trim(),
        if (_afterLessonId != null) 'afterLessonId': _afterLessonId,
        'questions': [
          {
            'textEn': _questionCtrl.text.trim(),
            'options': options,
            'correctKey': _correct,
          },
        ],
      });
      if (!mounted) return;
      _titleCtrl.clear();
      _questionCtrl.clear();
      _optA.clear();
      _optB.clear();
      _optC.clear();
      _optD.clear();
      setState(() => _afterLessonId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioQuizAdded)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioQuizSaveFailed('$e'))),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    if (widget.courses.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            l10n.t('student.noCertificatesHint'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.muted),
          ),
        ),
      );
    }

    final lessons = _lessons;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          l10n.t('student.quizzes'),
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.t('student.coursesDescription'),
          style: const TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: widget.courseId,
          decoration: InputDecoration(labelText: l10n.t('student.storeTitle')),
          items: widget.courses
              .map((c) => DropdownMenuItem(
                    value: c['id']?.toString(),
                    child: Text(c['titleEn']?.toString() ?? l10n.t('student.storeTitle')),
                  ))
              .toList(),
          onChanged: (id) {
            widget.onCourseChanged(id);
            setState(() => _afterLessonId = null);
          },
        ),
        const SizedBox(height: 14),
        DropdownButtonFormField<String?>(
          initialValue: _afterLessonId,
          decoration: InputDecoration(labelText: l10n.t('student.videos')),
          items: [
            DropdownMenuItem(value: null, child: Text(l10n.studioAtEndOfCourse)),
            ...lessons.map(
              (l) => DropdownMenuItem(
                value: l['id']?.toString(),
                child: Text(
                  l['title']?.toString() ?? l10n.t('student.videos'),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          onChanged: lessons.isEmpty ? null : (v) => setState(() => _afterLessonId = v),
        ),
        if (lessons.isEmpty) ...[
          const SizedBox(height: 8),
          Text(
            l10n.t('student.noVideo'),
            style: const TextStyle(color: Colors.orangeAccent, fontSize: 12),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: _titleCtrl,
          decoration: InputDecoration(labelText: l10n.t('student.quizzes')),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _questionCtrl,
          maxLines: 2,
          decoration: InputDecoration(labelText: l10n.t('quiz.question')),
        ),
        const SizedBox(height: 14),
        TextField(controller: _optA, decoration: InputDecoration(labelText: 'A')),
        const SizedBox(height: 10),
        TextField(controller: _optB, decoration: InputDecoration(labelText: 'B')),
        const SizedBox(height: 10),
        TextField(controller: _optC, decoration: InputDecoration(labelText: 'C (${l10n.t('student.optional')})')),
        const SizedBox(height: 10),
        TextField(controller: _optD, decoration: InputDecoration(labelText: 'D (${l10n.t('student.optional')})')),
        const SizedBox(height: 14),
        Text(l10n.studioCorrectAnswer, style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: ['A', 'B', 'C', 'D'].map((k) {
            final enabled = k == 'A' ||
                k == 'B' ||
                (k == 'C' && _optC.text.isNotEmpty) ||
                (k == 'D' && _optD.text.isNotEmpty);
            return ChoiceChip(
              label: Text(k),
              selected: _correct == k,
              onSelected: enabled ? (_) => setState(() => _correct = k) : null,
            );
          }).toList(),
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton.icon(
            onPressed: _saving || lessons.isEmpty ? null : _submit,
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.quiz_outlined),
            label: Text(_saving ? l10n.t('student.issuing') : l10n.t('student.quizzes')),
          ),
        ),
      ],
    );
  }
}
