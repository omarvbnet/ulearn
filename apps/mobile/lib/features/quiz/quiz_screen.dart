import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';

class QuizScreen extends StatefulWidget {
  const QuizScreen({super.key, required this.quizId, required this.title});

  final String quizId;
  final String title;

  @override
  State<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends State<QuizScreen> {
  Map<String, dynamic>? _quiz;
  String? _error;
  bool _started = false;
  int _current = 0;
  final Map<String, String> _answers = {};
  int? _timeLeft;
  Timer? _timer;
  Map<String, dynamic>? _result;
  bool _submitting = false;
  late DateTime _startedAt;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/quizzes/${widget.quizId}');
      if (mounted) setState(() => _quiz = data['quiz'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = _friendlyQuizError(e.message));
    } catch (_) {
      if (mounted) setState(() => _error = context.l10n.t('mobile.quiz.loadFailed'));
    }
  }

  String _friendlyQuizError(String message) {
    final l10n = context.l10n;
    final lower = message.toLowerCase();
    if (lower.contains('subscribe') || lower.contains('access')) {
      return l10n.t('common.subscribeToUnlock');
    }
    if (lower.contains('attempt')) return message;
    if (lower.contains('not found')) return l10n.t('mobile.quiz.notFound');
    return message;
  }

  void _start() {
    setState(() {
      _started = true;
      _startedAt = DateTime.now();
      final limit = (_quiz?['timeLimitSec'] as num?)?.toInt();
      if (limit != null && limit > 0) {
        _timeLeft = limit;
        _timer = Timer.periodic(const Duration(seconds: 1), (_) {
          if (_timeLeft != null && _timeLeft! <= 1) {
            _submit();
          } else {
            setState(() => _timeLeft = _timeLeft! - 1);
          }
        });
      }
    });
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

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.quiz_outlined, size: 48, color: AppTheme.muted.withValues(alpha: 0.5)),
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.muted, height: 1.4),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(onPressed: _load, child: Text(l10n.retry)),
                  ],
                ),
              ),
            )
          : _quiz == null
              ? Skeleton(
                  child: ListView(
                    physics: const NeverScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(20),
                    children: const [
                      SkeletonLine(width: 180, height: 16),
                      SizedBox(height: 12),
                      SkeletonLine(width: 260, height: 11),
                      SizedBox(height: 6),
                      SkeletonLine(width: 220, height: 11),
                      SizedBox(height: 28),
                      SkeletonBox(height: 56, radius: 14),
                      SizedBox(height: 12),
                      SkeletonBox(height: 56, radius: 14),
                      SizedBox(height: 12),
                      SkeletonBox(height: 56, radius: 14),
                      SizedBox(height: 12),
                      SkeletonBox(height: 56, radius: 14),
                      SizedBox(height: 28),
                      SkeletonBox(height: 48, radius: 12),
                    ],
                  ),
                )
              : _result != null
                  ? _ResultView(result: _result!, quiz: _quiz!)
                  : !_started
                      ? _IntroView(quiz: _quiz!, onStart: _start)
                      : _questionView(),
    );
  }

  Widget _questionView() {
    final l10n = context.l10n;
    final locale = context.localeCode;
    final questions = (_quiz!['questions'] as List<dynamic>).cast<Map<String, dynamic>>();
    final q = questions[_current];
    final options = _optionsOf(q, l10n);
    final selected = _answers[q['id']];

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: (_current + 1) / questions.length,
                    minHeight: 6,
                    backgroundColor: AppTheme.cardBorder,
                    valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
                  ),
                ),
              ),
              if (_timeLeft != null) ...[
                const SizedBox(width: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: _timeLeft! <= 30
                        ? Colors.redAccent.withValues(alpha: 0.15)
                        : AppTheme.card,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${_timeLeft! ~/ 60}:${(_timeLeft! % 60).toString().padLeft(2, '0')}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: _timeLeft! <= 30 ? Colors.redAccent : AppTheme.accent,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 20),
          Text(
            '${l10n.t('quiz.question')} ${_current + 1} ${l10n.t('quiz.of')} ${questions.length}',
            style: const TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          const SizedBox(height: 8),
          Text(
            localizedText(q, locale, prefix: 'text'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 20),
          Expanded(
            child: ListView.builder(
              itemCount: options.length,
              itemBuilder: (context, i) {
                final opt = options[i];
                final isSelected = selected == opt.$1;
                return StaggeredItem(
                  index: i,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(14),
                      onTap: () => setState(() => _answers[q['id'] as String] = opt.$1),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? AppTheme.accent.withValues(alpha: 0.1)
                              : AppTheme.card,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: isSelected ? AppTheme.accent : AppTheme.cardBorder,
                          ),
                        ),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 14,
                              backgroundColor:
                                  isSelected ? AppTheme.accent : AppTheme.cardBorder,
                              child: Text(
                                opt.$1.toUpperCase(),
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: isSelected ? Colors.black : AppTheme.muted,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(child: Text(opt.$2)),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Row(
            children: [
              if (_current > 0)
                OutlinedButton(
                  onPressed: () => setState(() => _current--),
                  child: Text(l10n.quizPrevious),
                ),
              const Spacer(),
              _current < questions.length - 1
                  ? ElevatedButton(
                      onPressed: () => setState(() => _current++),
                      style: ElevatedButton.styleFrom(minimumSize: const Size(120, 48)),
                      child: Text(l10n.quizNext),
                    )
                  : ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(minimumSize: const Size(120, 48)),
                      child: Text(_submitting ? l10n.quizSubmitting : l10n.quizSubmit),
                    ),
            ],
          ),
        ],
      ),
    );
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
}

class _IntroView extends StatelessWidget {
  const _IntroView({required this.quiz, required this.onStart});

  final Map<String, dynamic> quiz;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;
    final questions = (quiz['questions'] as List<dynamic>?)?.length ?? 0;
    final limit = (quiz['timeLimitSec'] as num?)?.toInt();
    final attemptsLeft = ((quiz['maxAttempts'] as num?)?.toInt() ?? 1) -
        ((quiz['attemptsUsed'] as num?)?.toInt() ?? 0);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ScaleIn(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.quiz_outlined, size: 56, color: AppTheme.accent),
              const SizedBox(height: 16),
              Text(
                localizedText(quiz, locale),
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _Stat(label: l10n.t('quiz.questions'), value: '$questions'),
                  _Stat(
                    label: l10n.t('quiz.time'),
                    value: limit != null && limit > 0 ? '${limit ~/ 60}m' : '∞',
                  ),
                  _Stat(label: l10n.t('quiz.attemptsLeft'), value: '$attemptsLeft'),
                ],
              ),
              const SizedBox(height: 28),
              ElevatedButton(onPressed: onStart, child: Text(l10n.quizStart)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 6),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        children: [
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
        ],
      ),
    );
  }
}

class _ResultView extends StatelessWidget {
  const _ResultView({required this.result, required this.quiz});

  final Map<String, dynamic> result;
  final Map<String, dynamic> quiz;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final passed = result['passed'] == true;
    final pct = ((result['percentage'] as num?) ?? 0).toDouble();
    final color = passed ? Colors.greenAccent : Colors.redAccent;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleIn(
              child: Container(
                width: 130,
                height: 130,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color.withValues(alpha: 0.12),
                  border: Border.all(color: color, width: 3),
                ),
                child: Center(
                  child: Text(
                    '${pct.round()}%',
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              passed ? l10n.quizPassed : l10n.quizFailed,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              '${result['score']} / ${result['maxScore']} ${l10n.t('quiz.points')}',
              style: const TextStyle(color: AppTheme.muted),
            ),
            const SizedBox(height: 28),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(l10n.quizDone),
            ),
          ],
        ),
      ),
    );
  }
}
