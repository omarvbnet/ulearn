import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

/// Ask & answer thread for a course video lesson.
class LessonQASection extends StatefulWidget {
  const LessonQASection({super.key, required this.lessonId});

  final String lessonId;

  @override
  State<LessonQASection> createState() => _LessonQASectionState();
}

class _LessonQASectionState extends State<LessonQASection> {
  List<Map<String, dynamic>> _questions = [];
  bool _loading = true;
  final _askCtrl = TextEditingController();
  final _answerCtrls = <String, TextEditingController>{};
  bool _posting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _askCtrl.dispose();
    for (final c in _answerCtrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context
          .read<ApiClient>()
          .get('/api/store/lessons/${widget.lessonId}/questions');
      if (!mounted) return;
      setState(() {
        _questions = ((data['questions'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _ask() async {
    final body = _askCtrl.text.trim();
    if (body.isEmpty || _posting) return;
    setState(() => _posting = true);
    try {
      final data = await context.read<ApiClient>().post(
            '/api/store/lessons/${widget.lessonId}/questions',
            {'body': body},
          );
      if (!mounted) return;
      setState(() {
        _questions.insert(0, data['question'] as Map<String, dynamic>);
        _askCtrl.clear();
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not post your question')),
      );
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _answer(String questionId) async {
    final ctrl = _answerCtrls.putIfAbsent(questionId, TextEditingController.new);
    final body = ctrl.text.trim();
    if (body.isEmpty || _posting) return;
    setState(() => _posting = true);
    try {
      final data = await context.read<ApiClient>().post(
            '/api/store/questions/$questionId/answers',
            {'body': body},
          );
      if (!mounted) return;
      final answer = data['answer'] as Map<String, dynamic>;
      setState(() {
        final q = _questions.firstWhere((q) => q['id'] == questionId);
        final answers = (q['answers'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        answers.add(answer);
        q['answers'] = answers;
        ctrl.clear();
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not post your answer')),
      );
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Skeleton(
          child: Column(
            children: const [
              SkeletonBox(height: 48, radius: 12),
              SizedBox(height: 10),
              SkeletonBox(height: 72, radius: 12),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Ask & Answer',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _askCtrl,
                minLines: 1,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: 'Ask a question about this video…',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _posting ? null : _ask,
              child: Text(_posting ? '…' : 'Ask'),
            ),
          ],
        ),
        const SizedBox(height: 14),
        if (_questions.isEmpty)
          const Text(
            'No questions yet — be the first to ask!',
            style: TextStyle(color: AppTheme.muted, fontSize: 13),
          )
        else
          ..._questions.asMap().entries.map((e) {
            final q = e.value;
            final user = q['user'] as Map<String, dynamic>?;
            final name = user?['fullLegalName']?.toString() ?? 'Student';
            final role = user?['role']?.toString() ?? 'STUDENT';
            final answers =
                (q['answers'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
            final qid = q['id'].toString();
            final answerCtrl =
                _answerCtrls.putIfAbsent(qid, TextEditingController.new);

            return StaggeredItem(
              index: e.key,
              child: Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.card,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppTheme.cardBorder),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: AppTheme.primary.withValues(alpha: 0.2),
                          child: Text(
                            name.isNotEmpty ? name[0].toUpperCase() : '?',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text(
                                role == 'TEACHER' ? 'Teacher' : 'Student',
                                style: const TextStyle(fontSize: 11, color: AppTheme.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(q['body']?.toString() ?? ''),
                    if (answers.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      ...answers.map((a) {
                        final au = a['user'] as Map<String, dynamic>?;
                        final an = au?['fullLegalName']?.toString() ?? 'User';
                        final isTeacher = au?['role'] == 'TEACHER';
                        return Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: isTeacher
                                ? AppTheme.accent.withValues(alpha: 0.08)
                                : AppTheme.background,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: isTeacher
                                  ? AppTheme.accent.withValues(alpha: 0.25)
                                  : AppTheme.cardBorder,
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                an,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: isTeacher ? AppTheme.accent : AppTheme.foreground,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(a['body']?.toString() ?? ''),
                            ],
                          ),
                        );
                      }),
                    ],
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: answerCtrl,
                            minLines: 1,
                            maxLines: 2,
                            decoration: const InputDecoration(
                              hintText: 'Write an answer…',
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: _posting ? null : () => _answer(qid),
                          child: const Text('Reply'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
