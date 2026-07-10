import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Teacher mobile tab: build a quiz with multiple questions and optional per-question timers.
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

class _QuizQuestionDraft {
  _QuizQuestionDraft();

  final textCtrl = TextEditingController();
  final optA = TextEditingController();
  final optB = TextEditingController();
  final optC = TextEditingController();
  final optD = TextEditingController();
  final timeSecCtrl = TextEditingController(text: '60');
  String correct = 'A';
  bool timerEnabled = false;

  void dispose() {
    textCtrl.dispose();
    optA.dispose();
    optB.dispose();
    optC.dispose();
    optD.dispose();
    timeSecCtrl.dispose();
  }

  Map<String, dynamic>? toPayload() {
    if (textCtrl.text.trim().isEmpty) return null;
    if (optA.text.trim().isEmpty || optB.text.trim().isEmpty) return null;

    final options = <String, String>{
      'A': optA.text.trim(),
      'B': optB.text.trim(),
      if (optC.text.trim().isNotEmpty) 'C': optC.text.trim(),
      if (optD.text.trim().isNotEmpty) 'D': optD.text.trim(),
    };

    final payload = <String, dynamic>{
      'textEn': textCtrl.text.trim(),
      'options': options,
      'correctKey': correct,
    };

    if (timerEnabled) {
      final sec = int.tryParse(timeSecCtrl.text.trim());
      if (sec != null && sec > 0) payload['timeLimitSec'] = sec;
    }

    return payload;
  }
}

class _TeacherQuizTabState extends State<TeacherQuizTab> {
  final _titleCtrl = TextEditingController();
  final List<_QuizQuestionDraft> _questions = [_QuizQuestionDraft()];
  String? _afterLessonId;
  bool _saving = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    for (final q in _questions) {
      q.dispose();
    }
    super.dispose();
  }

  List<Map<String, dynamic>> get _lessons {
    final course = widget.courses.cast<Map<String, dynamic>?>().firstWhere(
          (c) => c?['id']?.toString() == widget.courseId,
          orElse: () => null,
        );
    return ((course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
  }

  void _addQuestion() {
    setState(() => _questions.add(_QuizQuestionDraft()));
  }

  void _removeQuestion(int index) {
    if (_questions.length <= 1) return;
    setState(() {
      _questions.removeAt(index).dispose();
    });
  }

  Future<void> _submit() async {
    final courseId = widget.courseId;
    final l10n = context.l10n;
    if (courseId == null || _titleCtrl.text.trim().isEmpty) return;

    final payloads = <Map<String, dynamic>>[];
    for (final q in _questions) {
      final p = q.toPayload();
      if (p == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.studioAddQuizMinOptions)),
        );
        return;
      }
      payloads.add(p);
    }

    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/$courseId/quizzes', {
        'titleEn': _titleCtrl.text.trim(),
        if (_afterLessonId != null) 'afterLessonId': _afterLessonId,
        'questions': payloads,
      });
      if (!mounted) return;
      _titleCtrl.clear();
      for (final q in _questions) {
        q.dispose();
      }
      _questions
        ..clear()
        ..add(_QuizQuestionDraft());
      setState(() => _afterLessonId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.studioQuizAdded)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.studioQuizSaveFailed('$e'))),
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
          l10n.t('mobile.studio.quizBuilderHint'),
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
          decoration: InputDecoration(
            labelText: l10n.t('mobile.teacher.placeAfterVideo'),
            helperText: l10n.t('mobile.teacher.placeOptionalHint'),
          ),
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
          decoration: InputDecoration(labelText: l10n.t('mobile.studio.quizTitle')),
        ),
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.t('mobile.studio.questionsSection', {'count': '${_questions.length}'}),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
            ),
            TextButton.icon(
              onPressed: _addQuestion,
              icon: const Icon(Icons.add, size: 18),
              label: Text(l10n.t('mobile.studio.addQuestion')),
            ),
          ],
        ),
        ..._questions.asMap().entries.map((entry) {
          final index = entry.key;
          final draft = entry.value;
          return _QuestionEditorCard(
            key: ValueKey(draft),
            index: index,
            draft: draft,
            canRemove: _questions.length > 1,
            onRemove: () => _removeQuestion(index),
            onChanged: () => setState(() {}),
          );
        }),
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
            label: Text(_saving ? l10n.t('student.issuing') : l10n.t('mobile.studio.saveQuiz')),
          ),
        ),
      ],
    );
  }
}

class _QuestionEditorCard extends StatelessWidget {
  const _QuestionEditorCard({
    super.key,
    required this.index,
    required this.draft,
    required this.canRemove,
    required this.onRemove,
    required this.onChanged,
  });

  final int index;
  final _QuizQuestionDraft draft;
  final bool canRemove;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      color: AppTheme.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppTheme.cardBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  l10n.t('mobile.studio.questionNumber', {'n': '${index + 1}'}),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                if (canRemove)
                  IconButton(
                    onPressed: onRemove,
                    icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 20),
                    tooltip: l10n.t('mobile.studio.removeQuestion'),
                  ),
              ],
            ),
            TextField(
              controller: draft.textCtrl,
              maxLines: 2,
              onChanged: (_) => onChanged(),
              decoration: InputDecoration(labelText: l10n.t('quiz.question')),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: draft.optA,
              onChanged: (_) => onChanged(),
              decoration: const InputDecoration(labelText: 'A'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: draft.optB,
              onChanged: (_) => onChanged(),
              decoration: const InputDecoration(labelText: 'B'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: draft.optC,
              onChanged: (_) => onChanged(),
              decoration: InputDecoration(labelText: 'C (${l10n.t('student.optional')})'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: draft.optD,
              onChanged: (_) => onChanged(),
              decoration: InputDecoration(labelText: 'D (${l10n.t('student.optional')})'),
            ),
            const SizedBox(height: 12),
            Text(l10n.studioCorrectAnswer, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: ['A', 'B', 'C', 'D'].map((k) {
                final enabled = k == 'A' ||
                    k == 'B' ||
                    (k == 'C' && draft.optC.text.isNotEmpty) ||
                    (k == 'D' && draft.optD.text.isNotEmpty);
                return ChoiceChip(
                  label: Text(k),
                  selected: draft.correct == k,
                  onSelected: enabled
                      ? (_) {
                          draft.correct = k;
                          onChanged();
                        }
                      : null,
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.t('mobile.studio.enableQuestionTimer')),
              subtitle: Text(
                l10n.t('mobile.studio.enableQuestionTimerHint'),
                style: const TextStyle(fontSize: 12, color: AppTheme.muted),
              ),
              value: draft.timerEnabled,
              activeThumbColor: AppTheme.accent,
              onChanged: (v) {
                draft.timerEnabled = v;
                onChanged();
              },
            ),
            if (draft.timerEnabled) ...[
              const SizedBox(height: 4),
              TextField(
                controller: draft.timeSecCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: l10n.t('mobile.studio.timerSeconds'),
                  suffixText: l10n.t('mobile.studio.secondsShort'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
