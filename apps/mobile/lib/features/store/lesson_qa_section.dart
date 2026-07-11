import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

/// Ask & answer thread for a course video lesson.
class LessonQASection extends StatefulWidget {
  const LessonQASection({
    super.key,
    required this.lessonId,
    this.onComposerFocusChanged,
  });

  final String lessonId;
  final ValueChanged<bool>? onComposerFocusChanged;

  @override
  State<LessonQASection> createState() => _LessonQASectionState();
}

class _LessonQASectionState extends State<LessonQASection> {
  List<Map<String, dynamic>> _questions = [];
  bool _loading = true;
  final _askCtrl = TextEditingController();
  final _answerCtrls = <String, TextEditingController>{};
  final _askFocus = FocusNode();
  final _answerFocusNodes = <String, FocusNode>{};
  bool _posting = false;

  @override
  void initState() {
    super.initState();
    _askFocus.addListener(_syncComposerFocus);
    _load();
  }

  @override
  void dispose() {
    widget.onComposerFocusChanged?.call(false);
    _askFocus.removeListener(_syncComposerFocus);
    _askFocus.dispose();
    _askCtrl.dispose();
    for (final node in _answerFocusNodes.values) {
      node.removeListener(_syncComposerFocus);
      node.dispose();
    }
    for (final c in _answerCtrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  FocusNode _answerFocusFor(String questionId) {
    return _answerFocusNodes.putIfAbsent(questionId, () {
      final node = FocusNode();
      node.addListener(_syncComposerFocus);
      return node;
    });
  }

  void _syncComposerFocus() {
    final focused =
        _askFocus.hasFocus || _answerFocusNodes.values.any((n) => n.hasFocus);
    widget.onComposerFocusChanged?.call(focused);
    if (focused) {
      _scrollFocusedFieldIntoView();
    }
  }

  void _scrollFocusedFieldIntoView() {
    void scroll() {
      if (!mounted) return;
      FocusNode? focused;
      if (_askFocus.hasFocus) {
        focused = _askFocus;
      } else {
        for (final node in _answerFocusNodes.values) {
          if (node.hasFocus) {
            focused = node;
            break;
          }
        }
      }
      final ctx = focused?.context;
      if (ctx == null || !ctx.mounted) return;
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.25,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      scroll();
      Future.delayed(const Duration(milliseconds: 320), () {
        if (mounted) scroll();
      });
    });
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
      _askFocus.unfocus();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.qaPostFailed)),
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
      _answerFocusFor(questionId).unfocus();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.qaAnswerFailed)),
      );
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

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
        Text(
          l10n.t('student.qaTitle'),
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _askCtrl,
                focusNode: _askFocus,
                minLines: 1,
                maxLines: 3,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _ask(),
                decoration: InputDecoration(
                  hintText: l10n.t('student.askPlaceholder'),
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _posting ? null : _ask,
              child: Text(_posting ? l10n.t('student.posting') : l10n.t('student.askQuestion')),
            ),
          ],
        ),
        const SizedBox(height: 14),
        if (_questions.isEmpty)
          Text(
            l10n.t('student.noQuestions'),
            style: TextStyle(color: AppTheme.muted, fontSize: 13),
          )
        else
          ..._questions.asMap().entries.map((e) {
            final q = e.value;
            final user = q['user'] as Map<String, dynamic>?;
            final name = user?['fullLegalName']?.toString() ?? l10n.t('mobile.roles.student');
            final role = user?['role']?.toString() ?? 'STUDENT';
            final answers =
                (q['answers'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
            final qid = q['id'].toString();
            final answerCtrl =
                _answerCtrls.putIfAbsent(qid, TextEditingController.new);
            final answerFocus = _answerFocusFor(qid);

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
                                role == 'TEACHER'
                                    ? l10n.t('student.teacher')
                                    : l10n.t('mobile.roles.student'),
                                style: TextStyle(fontSize: 11, color: AppTheme.muted),
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
                        final an = au?['fullLegalName']?.toString() ?? l10n.t('mobile.roles.student');
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
                            focusNode: answerFocus,
                            minLines: 1,
                            maxLines: 2,
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _answer(qid),
                            decoration: InputDecoration(
                              hintText: l10n.t('student.comment'),
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: _posting ? null : () => _answer(qid),
                          child: Text(l10n.qaReply),
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
