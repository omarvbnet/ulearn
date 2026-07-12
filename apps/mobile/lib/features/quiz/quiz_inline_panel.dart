import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// Compact in-place quiz for the course detail player slot.
class QuizInlinePanel extends StatefulWidget {
  const QuizInlinePanel({
    super.key,
    required this.quizId,
    required this.title,
    required this.onFinished,
  });

  final String quizId;
  final String title;
  final VoidCallback onFinished;

  @override
  State<QuizInlinePanel> createState() => _QuizInlinePanelState();
}

class _QuizInlinePanelState extends State<QuizInlinePanel> {
  Map<String, dynamic>? _quiz;
  String? _error;
  bool _started = false;
  int _current = 0;
  final Map<String, String> _answers = {};
  int? _timeLeft;
  Timer? _timer;
  bool _perQuestionTimers = false;
  Map<String, dynamic>? _result;
  bool _submitting = false;
  late DateTime _startedAt;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/quizzes/${widget.quizId}');
      if (mounted) setState(() => _quiz = data['quiz'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = context.l10n.t('mobile.quiz.loadFailed'));
    }
  }

  bool get _hasPerQuestionTimers {
    final questions = (_quiz?['questions'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    return questions.any((q) => ((q['timeLimitSec'] as num?) ?? 0) > 0);
  }

  void _startGlobalTimer(int limit) {
    _timer?.cancel();
    setState(() => _timeLeft = limit);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_timeLeft != null && _timeLeft! <= 1) {
        _submit();
      } else {
        setState(() => _timeLeft = _timeLeft! - 1);
      }
    });
  }

  void _resetQuestionTimer() {
    _timer?.cancel();
    final questions = (_quiz!['questions'] as List<dynamic>).cast<Map<String, dynamic>>();
    if (_current >= questions.length) return;
    final limit = (questions[_current]['timeLimitSec'] as num?)?.toInt();
    if (limit != null && limit > 0) {
      setState(() => _timeLeft = limit);
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        if (_timeLeft != null && _timeLeft! <= 1) {
          _timer?.cancel();
          if (_current < questions.length - 1) {
            setState(() => _current++);
            _resetQuestionTimer();
          } else {
            _submit();
          }
        } else {
          setState(() => _timeLeft = _timeLeft! - 1);
        }
      });
    } else {
      setState(() => _timeLeft = null);
    }
  }

  void _start() {
    _perQuestionTimers = _hasPerQuestionTimers;
    setState(() {
      _started = true;
      _startedAt = DateTime.now();
    });
    if (_perQuestionTimers) {
      _resetQuestionTimer();
      return;
    }
    final limit = (_quiz?['timeLimitSec'] as num?)?.toInt();
    if (limit != null && limit > 0) _startGlobalTimer(limit);
  }

  Future<void> _submit() async {
    if (_submitting) return;
    _timer?.cancel();
    setState(() => _submitting = true);
    try {
      final data = await context.read<ApiClient>().post(
        '/api/quizzes/${widget.quizId}',
        {
          'answers': _answers,
          'timeSpentSec': DateTime.now().difference(_startedAt).inSeconds,
        },
      );
      if (mounted) setState(() => _result = data['attempt'] as Map<String, dynamic>);
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  static List<(String, String)> _optionsOf(Map<String, dynamic> q, AppLocalizations l10n) {
    if (q['type'] == 'TRUE_FALSE') {
      return [('true', l10n.quizTrue), ('false', l10n.quizFalse)];
    }
    final raw = q['options'];
    if (raw is Map) {
      return raw.entries.map((e) => (e.key.toString(), e.value.toString())).toList();
    }
    if (raw is List) {
      return raw
          .cast<Map<String, dynamic>>()
          .map((o) => (o['key'].toString(), o['label'].toString()))
          .toList();
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Container(
      constraints: const BoxConstraints(minHeight: 220),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: AppTheme.card,
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: _error != null
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: AppTheme.muted)),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: widget.onFinished, child: Text(l10n.next)),
                ],
              ),
            )
          : _quiz == null
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: SkeletonBox(height: 160, radius: 12),
                )
              : _result != null
                  ? _InlineResult(
                      result: _result!,
                      onContinue: widget.onFinished,
                    )
                  : !_started
                      ? _InlineIntro(
                          quiz: _quiz!,
                          title: widget.title,
                          onStart: _start,
                        )
                      : _questionBody(l10n),
    );
  }

  Widget _questionBody(AppLocalizations l10n) {
    final locale = context.localeCode;
    final questions = (_quiz!['questions'] as List<dynamic>).cast<Map<String, dynamic>>();
    final q = questions[_current];
    final options = _optionsOf(q, l10n);
    final selected = _answers[q['id']];

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  l10n.t('mobile.store.quizStep'),
                  style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w700),
                ),
              ),
              const Spacer(),
              Text(
                '${_current + 1}/${questions.length}',
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              if (_timeLeft != null) ...[
                const SizedBox(width: 10),
                Text(
                  '${_timeLeft! ~/ 60}:${(_timeLeft! % 60).toString().padLeft(2, '0')}',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: _timeLeft! <= 30 ? Colors.redAccent : AppTheme.accent,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: (_current + 1) / questions.length,
              minHeight: 5,
              backgroundColor: AppTheme.cardBorder,
              valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            localizedText(q, locale, prefix: 'text'),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.35),
          ),
          const SizedBox(height: 12),
          ...options.map((opt) {
            final isSelected = selected == opt.$1;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: isSelected ? AppTheme.accent.withValues(alpha: 0.18) : AppTheme.card,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => setState(() => _answers[q['id'].toString()] = opt.$1),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected ? AppTheme.accent : AppTheme.cardBorder,
                      ),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 12,
                          backgroundColor: isSelected ? AppTheme.accent : AppTheme.cardBorder,
                          child: Text(
                            opt.$1.toUpperCase(),
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: isSelected ? Colors.black : AppTheme.muted,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: Text(opt.$2)),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }),
          const SizedBox(height: 8),
          Row(
            children: [
              if (_current > 0)
                OutlinedButton(
                  onPressed: () {
                    setState(() => _current--);
                    if (_perQuestionTimers) _resetQuestionTimer();
                  },
                  child: Text(l10n.quizPrevious),
                ),
              const Spacer(),
              FilledButton(
                onPressed: _current < questions.length - 1
                    ? () {
                        setState(() => _current++);
                        if (_perQuestionTimers) _resetQuestionTimer();
                      }
                    : (_submitting ? null : _submit),
                child: Text(
                  _current < questions.length - 1
                      ? l10n.quizNext
                      : (_submitting ? l10n.quizSubmitting : l10n.quizSubmit),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _InlineIntro extends StatelessWidget {
  const _InlineIntro({
    required this.quiz,
    required this.title,
    required this.onStart,
  });

  final Map<String, dynamic> quiz;
  final String title;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final questions = (quiz['questions'] as List<dynamic>?)?.length ?? 0;
    final passPct = (quiz['passPercentage'] as num?)?.toInt() ?? 50;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppTheme.accent.withValues(alpha: 0.15),
            ),
            child: const Icon(Icons.quiz_outlined, color: AppTheme.accent, size: 28),
          ),
          const SizedBox(height: 14),
          Text(
            l10n.t('mobile.store.quizAfterLesson'),
            style: TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          Text(
            '${l10n.t('quiz.questions')}: $questions · ${l10n.t('quiz.passMark')} $passPct%',
            style: TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: onStart,
            icon: const Icon(Icons.play_arrow_rounded),
            label: Text(l10n.quizStart),
          ),
        ],
      ),
    );
  }
}

class _InlineResult extends StatelessWidget {
  const _InlineResult({required this.result, required this.onContinue});

  final Map<String, dynamic> result;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final passed = result['passed'] == true;
    final pct = ((result['percentage'] as num?) ?? 0).toDouble();
    final color = passed ? Colors.greenAccent : Colors.orangeAccent;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${pct.round()}%',
            style: TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: color),
          ),
          const SizedBox(height: 6),
          Text(
            passed ? l10n.quizPassed : l10n.quizFailed,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: onContinue,
            child: Text(l10n.next),
          ),
        ],
      ),
    );
  }
}
