import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

class AiExamQuestionView {
  AiExamQuestionView({
    required this.text,
    required this.options,
    this.imageBase64,
  });

  final String text;
  final Map<String, String> options;
  final String? imageBase64;

  factory AiExamQuestionView.fromJson(Map<String, dynamic> json) {
    final opts = <String, String>{};
    final raw = json['options'];
    if (raw is Map) {
      raw.forEach((k, v) => opts[k.toString()] = v.toString());
    }
    final img = json['imageBase64']?.toString();
    return AiExamQuestionView(
      text: json['text']?.toString() ?? '',
      options: opts,
      imageBase64: (img != null && img.isNotEmpty) ? img : null,
    );
  }
}

class AiPracticeExamData {
  AiPracticeExamData({
    required this.examAttemptId,
    required this.title,
    required this.questions,
    required this.timeLimitSec,
  });

  final String examAttemptId;
  final String title;
  final List<AiExamQuestionView> questions;
  final int timeLimitSec;

  factory AiPracticeExamData.fromJson(Map<String, dynamic> json) {
    final qs = ((json['questions'] as List?) ?? [])
        .whereType<Map>()
        .map((q) => AiExamQuestionView.fromJson(Map<String, dynamic>.from(q)))
        .toList();
    return AiPracticeExamData(
      examAttemptId: json['examAttemptId']?.toString() ?? '',
      title: json['title']?.toString() ?? 'Exam',
      questions: qs,
      timeLimitSec: (json['timeLimitSec'] as num?)?.toInt() ?? 90,
    );
  }
}

/// Interactive timed MCQ panel embedded in chat.
class AiExamPanel extends StatefulWidget {
  const AiExamPanel({
    super.key,
    required this.exam,
    required this.onSubmit,
    this.disabled = false,
  });

  final AiPracticeExamData exam;
  final Future<void> Function(Map<String, String> answers, int elapsedSec, bool expired)
      onSubmit;
  final bool disabled;

  @override
  State<AiExamPanel> createState() => _AiExamPanelState();
}

class _AiExamPanelState extends State<AiExamPanel> {
  late int _remaining;
  late final DateTime _startedAt;
  Timer? _timer;
  final Map<String, String> _answers = {};
  bool _submitting = false;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _remaining = widget.exam.timeLimitSec;
    _startedAt = DateTime.now();
    if (!widget.disabled) {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || _done) return;
        setState(() => _remaining = (_remaining - 1).clamp(0, 99999));
        if (_remaining <= 0) {
          _finish(expired: true);
        }
      });
    } else {
      _done = true;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _finish({required bool expired}) async {
    if (_submitting || _done) return;
    setState(() {
      _submitting = true;
      _done = true;
    });
    _timer?.cancel();
    final elapsed = DateTime.now().difference(_startedAt).inSeconds;
    try {
      await widget.onSubmit(_answers, elapsed, expired);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _fmt(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final urgent = _remaining <= 30 && !_done;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.14),
            AppTheme.accent.withValues(alpha: 0.08),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.exam.title,
                  style: TextStyle(
                    color: AppTheme.foreground,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: urgent
                      ? const Color(0xFFEF4444).withValues(alpha: 0.2)
                      : AppTheme.card,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: urgent
                        ? const Color(0xFFEF4444)
                        : AppTheme.cardBorder,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.timer_outlined,
                      size: 14,
                      color: urgent
                          ? const Color(0xFFEF4444)
                          : AppTheme.accent,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _fmt(_remaining),
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: urgent
                            ? const Color(0xFFEF4444)
                            : AppTheme.foreground,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            l10n.t('mobile.ai.examSelectAnswers'),
            style: TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          ...List.generate(widget.exam.questions.length, (i) {
            final q = widget.exam.questions[i];
            final key = '$i';
            final selected = _answers[key];
            return Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${i + 1}. ${q.text}',
                    style: TextStyle(
                      color: AppTheme.foreground,
                      fontWeight: FontWeight.w600,
                      height: 1.35,
                    ),
                  ),
                  if (q.imageBase64 != null && q.imageBase64!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.memory(
                        base64Decode(q.imageBase64!),
                        fit: BoxFit.contain,
                        height: 180,
                        width: double.infinity,
                        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  ...q.options.entries.map((e) {
                    final isSel = selected == e.key;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: _done
                            ? null
                            : () => setState(() => _answers[key] = e.key),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: isSel
                                ? AppTheme.accent.withValues(alpha: 0.18)
                                : AppTheme.card,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSel
                                  ? AppTheme.accent
                                  : AppTheme.cardBorder,
                              width: isSel ? 1.4 : 1,
                            ),
                          ),
                          child: Text(
                            '${e.key}. ${e.value}',
                            style: TextStyle(
                              color: AppTheme.foreground,
                              fontWeight:
                                  isSel ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            );
          }),
          if (!_done)
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _submitting
                    ? null
                    : () => _finish(expired: false),
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        l10n.t('mobile.ai.examSubmit'),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}

class AiExamResultPanel extends StatelessWidget {
  const AiExamResultPanel({super.key, required this.result});

  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final passed = result['passed'] == true;
    final pct = (result['percentage'] as num?)?.toDouble() ?? 0;
    final score = result['score'];
    final maxScore = result['maxScore'];
    final analysis = result['analysis']?.toString() ?? '';
    final review = ((result['review'] as List?) ?? []).whereType<Map>().toList();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: passed
              ? const Color(0xFF22C55E).withValues(alpha: 0.5)
              : const Color(0xFFEF4444).withValues(alpha: 0.45),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                passed ? Icons.emoji_events_outlined : Icons.school_outlined,
                color: passed
                    ? const Color(0xFF22C55E)
                    : const Color(0xFFEF4444),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  passed
                      ? l10n.t('mobile.ai.examPassed')
                      : l10n.t('mobile.ai.examFailed'),
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                    color: AppTheme.foreground,
                  ),
                ),
              ),
              Text(
                '$pct%',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 22,
                  color: passed
                      ? const Color(0xFF22C55E)
                      : const Color(0xFFEF4444),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            l10n
                .t('mobile.ai.examScore')
                .replaceAll('{score}', '$score')
                .replaceAll('{max}', '$maxScore'),
            style: TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          if (analysis.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              l10n.t('mobile.ai.examAnalysis'),
              style: TextStyle(
                color: AppTheme.accent,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              analysis,
              style: TextStyle(color: AppTheme.foreground, height: 1.45),
            ),
          ],
          if (review.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              l10n.t('mobile.ai.examReview'),
              style: TextStyle(
                color: AppTheme.muted,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 6),
            ...review.take(8).map((r) {
              final ok = r['isCorrect'] == true;
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      ok ? Icons.check_circle : Icons.cancel,
                      size: 16,
                      color: ok
                          ? const Color(0xFF22C55E)
                          : const Color(0xFFEF4444),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        r['text']?.toString() ?? '',
                        style: TextStyle(
                          color: AppTheme.foreground,
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}
