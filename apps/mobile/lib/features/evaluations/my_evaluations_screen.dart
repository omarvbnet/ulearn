import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/ai/classroom/live_classroom_screen.dart';

/// Student-facing "report card" — one entry per material the AI teacher has
/// evaluated, with an understanding/confidence score plus a short written
/// evaluation (strengths, weaknesses, recommendation).
class MyEvaluationsScreen extends StatefulWidget {
  const MyEvaluationsScreen({super.key});

  @override
  State<MyEvaluationsScreen> createState() => _MyEvaluationsScreenState();
}

class _MyEvaluationsScreenState extends State<MyEvaluationsScreen> {
  List<Map<String, dynamic>> _entries = [];
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final data =
          await context.read<ApiClient>().get('/api/ai/classroom/evaluations');
      if (!mounted) return;
      setState(() {
        _entries =
            ((data['evaluations'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  void _continueMaterial(Map<String, dynamic> entry) {
    final docs = (entry['materialsKey']?.toString() ?? '')
        .split(',')
        .where((s) => s.trim().isNotEmpty)
        .toList();
    if (docs.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => LiveClassroomScreen(documentIds: docs),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: GlassAppBar(title: Text(l10n.t('mobile.evaluations.title'))),
      body: _loading
          ? SkeletonList(count: 3, itemBuilder: (_) => const SkeletonTextCard())
          : _failed
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        l10n.t('mobile.evaluations.loadError'),
                        style: TextStyle(color: AppTheme.muted),
                      ),
                      const SizedBox(height: 12),
                      TextButton(onPressed: _load, child: Text(l10n.retry)),
                    ],
                  ),
                )
              : _entries.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.school_outlined,
                              size: 48,
                              color: AppTheme.muted.withValues(alpha: 0.5),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              l10n.t('mobile.evaluations.empty'),
                              style: const TextStyle(fontWeight: FontWeight.w600),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              l10n.t('mobile.evaluations.emptyHint'),
                              style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85)),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _entries.length,
                        separatorBuilder: (context, index) => const SizedBox(height: 12),
                        itemBuilder: (context, index) =>
                            _EvaluationCard(entry: _entries[index], onContinue: _continueMaterial),
                      ),
                    ),
    );
  }
}

class _EvaluationCard extends StatelessWidget {
  const _EvaluationCard({required this.entry, required this.onContinue});

  final Map<String, dynamic> entry;
  final void Function(Map<String, dynamic> entry) onContinue;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final evaluation = entry['evaluation'] as Map<String, dynamic>?;
    final materialNames =
        ((entry['materialNames'] as List<dynamic>?) ?? []).cast<String>();
    final lessonName = entry['lessonName']?.toString();
    final understandingRaw = entry['understanding'];
    final confidenceRaw = entry['confidence'];
    final scorePercent = (evaluation?['scorePercent'] as num?)?.round() ??
        (understandingRaw is num ? (understandingRaw * 100).round() : 0);
    final confidencePercent =
        confidenceRaw is num ? (confidenceRaw * 100).round() : null;
    final totalLessons =
        (evaluation?['totalLessons'] as num?)?.toInt() ??
            (entry['totalLessons'] as num?)?.toInt() ??
            0;
    final lessonIndex = (entry['lessonIndex'] as num?)?.toInt();
    final lessonsCompleted =
        (evaluation?['lessonsCompleted'] as num?)?.toInt() ??
            (lessonIndex != null ? lessonIndex + 1 : 1);
    final strengths = ((evaluation?['strengths'] as List<dynamic>?) ?? []).cast<String>();
    final weaknesses = ((evaluation?['weaknesses'] as List<dynamic>?) ?? []).cast<String>();
    final recommendation = evaluation?['recommendation']?.toString() ?? '';
    final summary = evaluation?['summary']?.toString() ?? '';
    final grade = _gradeFor(scorePercent);
    final updatedAt = DateTime.tryParse(entry['updatedAt']?.toString() ?? '');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        materialNames.isNotEmpty
                            ? materialNames.join(', ')
                            : (lessonName ?? ''),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                      if (lessonName != null && lessonName.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(lessonName, style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                      ],
                      if (totalLessons > 0) ...[
                        const SizedBox(height: 2),
                        Text(
                          l10n.t('mobile.evaluations.progress', {
                            'current': '${lessonsCompleted.clamp(1, totalLessons)}',
                            'total': '$totalLessons',
                          }),
                          style: TextStyle(color: AppTheme.muted, fontSize: 11),
                        ),
                      ],
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: grade.color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: grade.color.withValues(alpha: 0.4)),
                  ),
                  child: Text(
                    l10n.t('mobile.evaluations.${grade.labelKey}'),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: grade.color,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _ScoreBar(label: l10n.t('mobile.evaluations.understanding'), percent: scorePercent),
            if (confidencePercent != null) ...[
              const SizedBox(height: 8),
              _ScoreBar(label: l10n.t('mobile.evaluations.confidence'), percent: confidencePercent),
            ],
            const SizedBox(height: 12),
            if (summary.isNotEmpty)
              Text(summary, style: const TextStyle(height: 1.4)),
            if (evaluation == null)
              Text(
                l10n.t('mobile.evaluations.pendingEvaluation'),
                style: TextStyle(color: AppTheme.muted, fontSize: 13),
              ),
            if (strengths.isNotEmpty) ...[
              const SizedBox(height: 10),
              _ChipGroup(
                label: l10n.t('mobile.evaluations.strengths'),
                items: strengths,
                color: Colors.greenAccent,
              ),
            ],
            if (weaknesses.isNotEmpty) ...[
              const SizedBox(height: 10),
              _ChipGroup(
                label: l10n.t('mobile.evaluations.weaknesses'),
                items: weaknesses,
                color: Colors.orangeAccent,
              ),
            ],
            if (recommendation.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3)),
                ),
                child: RichText(
                  text: TextSpan(
                    style: DefaultTextStyle.of(context).style.copyWith(fontSize: 13),
                    children: [
                      TextSpan(
                        text: '${l10n.t('mobile.evaluations.recommendation')}: ',
                        style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.accent),
                      ),
                      TextSpan(text: recommendation),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (updatedAt != null)
                  Text(
                    l10n.t('mobile.evaluations.updatedAt', {
                      'date':
                          '${updatedAt.year}-${updatedAt.month.toString().padLeft(2, '0')}-${updatedAt.day.toString().padLeft(2, '0')}',
                    }),
                    style: TextStyle(color: AppTheme.muted, fontSize: 11),
                  )
                else
                  const SizedBox.shrink(),
                OutlinedButton(
                  onPressed: () => onContinue(entry),
                  child: Text(l10n.t('mobile.evaluations.continueLesson')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  _Grade _gradeFor(int scorePercent) {
    if (scorePercent >= 85) {
      return _Grade('gradeExcellent', Colors.greenAccent);
    }
    if (scorePercent >= 70) {
      return _Grade('gradeGood', AppTheme.accent);
    }
    if (scorePercent >= 50) {
      return _Grade('gradeFair', Colors.orangeAccent);
    }
    return _Grade('gradeNeedsWork', Colors.redAccent);
  }
}

class _Grade {
  const _Grade(this.labelKey, this.color);
  final String labelKey;
  final Color color;
}

class _ScoreBar extends StatelessWidget {
  const _ScoreBar({required this.label, required this.percent});

  final String label;
  final int percent;

  @override
  Widget build(BuildContext context) {
    final clamped = percent.clamp(0, 100);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: TextStyle(color: AppTheme.muted, fontSize: 12)),
            Text(
              '$clamped%',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: LinearProgressIndicator(
            value: clamped / 100,
            minHeight: 6,
            backgroundColor: AppTheme.cardBorder,
            valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
          ),
        ),
      ],
    );
  }
}

class _ChipGroup extends StatelessWidget {
  const _ChipGroup({required this.label, required this.items, required this.color});

  final String label;
  final List<String> items;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            color: color,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: items
              .map(
                (s) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: color.withValues(alpha: 0.3)),
                  ),
                  child: Text(s, style: TextStyle(fontSize: 12, color: color)),
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}
