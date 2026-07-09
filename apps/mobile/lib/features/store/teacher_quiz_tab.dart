import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
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
        const SnackBar(content: Text('Add at least two answer options')),
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
        const SnackBar(content: Text('Quiz added to your course')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save quiz: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.courses.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Create a course on the web teacher portal first, then add videos before quizzes.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.muted),
          ),
        ),
      );
    }

    final lessons = _lessons;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Place a quiz between videos',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        const Text(
          'Students will see the quiz right after the selected video. At least 2 quizzes are required before course approval.',
          style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: widget.courseId,
          decoration: const InputDecoration(labelText: 'Course'),
          items: widget.courses
              .map((c) => DropdownMenuItem(
                    value: c['id']?.toString(),
                    child: Text(c['titleEn']?.toString() ?? 'Course'),
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
          decoration: const InputDecoration(labelText: 'After video'),
          items: [
            const DropdownMenuItem(value: null, child: Text('At end of course')),
            ...lessons.map(
              (l) => DropdownMenuItem(
                value: l['id']?.toString(),
                child: Text(
                  l['title']?.toString() ?? 'Video',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          onChanged: lessons.isEmpty ? null : (v) => setState(() => _afterLessonId = v),
        ),
        if (lessons.isEmpty) ...[
          const SizedBox(height: 8),
          const Text(
            'Upload at least one video before adding a quiz.',
            style: TextStyle(color: Colors.orangeAccent, fontSize: 12),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: _titleCtrl,
          decoration: const InputDecoration(labelText: 'Quiz title'),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _questionCtrl,
          maxLines: 2,
          decoration: const InputDecoration(labelText: 'Question'),
        ),
        const SizedBox(height: 14),
        TextField(controller: _optA, decoration: const InputDecoration(labelText: 'Option A')),
        const SizedBox(height: 10),
        TextField(controller: _optB, decoration: const InputDecoration(labelText: 'Option B')),
        const SizedBox(height: 10),
        TextField(controller: _optC, decoration: const InputDecoration(labelText: 'Option C (optional)')),
        const SizedBox(height: 10),
        TextField(controller: _optD, decoration: const InputDecoration(labelText: 'Option D (optional)')),
        const SizedBox(height: 14),
        const Text('Correct answer', style: TextStyle(fontWeight: FontWeight.w600)),
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
            label: Text(_saving ? 'Saving…' : 'Add quiz'),
          ),
        ),
      ],
    );
  }
}
