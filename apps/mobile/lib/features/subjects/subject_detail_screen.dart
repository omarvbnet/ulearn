import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart' show ApiClient, ApiException;
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/ai/ai_with_ulearn_entry.dart';
import 'package:ulearn/features/subjects/subject_scorecard_widgets.dart';

/// Full multi-dimensional Subject Scorecard — mirrors the web Subject Detail
/// page: headline gauges, a mastery trend sparkline, then every scored
/// dimension as a labeled progress row (nulled ones shown as "not enough
/// data yet").
class SubjectDetailScreen extends StatefulWidget {
  const SubjectDetailScreen({super.key, required this.subjectId});

  final String subjectId;

  @override
  State<SubjectDetailScreen> createState() => _SubjectDetailScreenState();
}

class _SubjectDetailScreenState extends State<SubjectDetailScreen> {
  Map<String, dynamic>? _scorecard;
  bool _loading = true;
  bool _failed = false;
  bool _notFound = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
      _notFound = false;
    });
    try {
      final data = await context
          .read<ApiClient>()
          .get('/api/student/subjects/${widget.subjectId}');
      if (!mounted) return;
      setState(() {
        _scorecard = data['scorecard'] as Map<String, dynamic>?;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final notFound = e is ApiException && e.statusCode == 404;
      setState(() {
        _loading = false;
        _notFound = notFound;
        _failed = !notFound;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final name = _scorecard != null
        ? localizedSubjectName(_scorecard!['subjectName'], context.localeCode)
        : '';
    return Scaffold(
      appBar: GlassAppBar(title: Text(name.isNotEmpty ? name : l10n.t('mobile.subjects.title'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _failed
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        l10n.t('mobile.subjects.loadError'),
                        style: TextStyle(color: AppTheme.muted),
                      ),
                      const SizedBox(height: 12),
                      TextButton(onPressed: _load, child: Text(l10n.retry)),
                    ],
                  ),
                )
              : _notFound || _scorecard == null
                  ? Center(
                      child: Text(
                        l10n.t('mobile.subjects.notFound'),
                        style: TextStyle(color: AppTheme.muted),
                        textAlign: TextAlign.center,
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _buildBody(context, _scorecard!),
                    ),
    );
  }

  Widget _buildBody(BuildContext context, Map<String, dynamic> s) {
    final l10n = context.l10n;
    final masteryScore = (s['masteryScore'] as num?)?.round() ?? 0;
    final aiConfidenceScore = (s['aiConfidenceScore'] as num?)?.round() ?? 0;
    final retentionScore = (s['retentionScore'] as num?)?.round() ?? 0;
    final level = s['performanceLevel']?.toString() ?? 'BEGINNER';
    final trend = s['trend']?.toString() ?? 'STABLE';
    final lastComputedAt = DateTime.tryParse(s['lastComputedAt']?.toString() ?? '');
    final trendHistory = ((s['trendHistory'] as List<dynamic>?) ?? [])
        .cast<Map<String, dynamic>>()
        .map((e) => (e['masteryScore'] as num?) ?? 0)
        .toList();

    int? scoreOf(String key) => (s[key] as num?)?.round();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    CircularScoreGauge(percent: masteryScore, label: l10n.t('mobile.subjects.mastery')),
                    CircularScoreGauge(
                      percent: aiConfidenceScore,
                      label: l10n.t('mobile.subjects.aiConfidence'),
                      color: Colors.lightBlueAccent,
                    ),
                    CircularScoreGauge(
                      percent: retentionScore,
                      label: l10n.t('mobile.subjects.retention'),
                      color: Colors.greenAccent,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: performanceLevelColor(level).withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: performanceLevelColor(level).withValues(alpha: 0.4)),
                      ),
                      child: Text(
                        l10n.t('mobile.subjects.levels.$level'),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: performanceLevelColor(level),
                        ),
                      ),
                    ),
                    Text(
                      '${trendArrow(trend)} ${l10n.t('mobile.subjects.trends.$trend')}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: trendColor(trend),
                      ),
                    ),
                  ],
                ),
                if (lastComputedAt != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    l10n.t('mobile.subjects.lastUpdated', {
                      'date':
                          '${lastComputedAt.year}-${lastComputedAt.month.toString().padLeft(2, '0')}-${lastComputedAt.day.toString().padLeft(2, '0')}',
                    }),
                    style: TextStyle(color: AppTheme.muted, fontSize: 11),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (trendHistory.length >= 2) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.t('mobile.subjects.trendChart'),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                  const SizedBox(height: 12),
                  TrendSparkline(points: trendHistory),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.t('mobile.subjects.dimensionsTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.quizAccuracy'),
                  percent: scoreOf('quizAccuracyScore'),
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.problemSolving'),
                  percent: scoreOf('problemSolvingScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.practicalSkills'),
                  percent: scoreOf('practicalSkillsScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.criticalThinking'),
                  percent: scoreOf('criticalThinkingScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.communication'),
                  percent: scoreOf('communicationScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.creativity'),
                  percent: scoreOf('creativityScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.learningSpeed'),
                  percent: scoreOf('learningSpeedScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.participation'),
                  percent: scoreOf('participationScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.attendance'),
                  percent: scoreOf('attendanceScore'),
                  hint: l10n.t('mobile.subjects.activityBased'),
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.consistency'),
                  percent: scoreOf('consistencyScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.improvement'),
                  percent: scoreOf('improvementScore'),
                  estimated: true,
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
                ScoreRow(
                  label: l10n.t('mobile.subjects.dimensions.homework'),
                  percent: scoreOf('homeworkScore'),
                  notEnoughDataLabel: l10n.t('mobile.subjects.notEnoughData'),
                  estimatedLabel: l10n.t('mobile.subjects.estimated'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: OutlinedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const AiWithULearnEntry()),
            ),
            child: Text(l10n.t('mobile.subjects.practiceThisSubject')),
          ),
        ),
      ],
    );
  }
}
