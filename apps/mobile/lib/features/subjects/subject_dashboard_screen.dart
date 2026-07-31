import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/subjects/subject_detail_screen.dart';
import 'package:ulearn/features/subjects/subject_scorecard_widgets.dart';

/// The student's "My Subjects" dashboard — one Subject Card per subject with
/// any recorded activity, showing Mastery/AI Confidence/Retention and the
/// learning trend at a glance. Mirrors the web Subject Dashboard.
class SubjectDashboardScreen extends StatefulWidget {
  const SubjectDashboardScreen({super.key});

  @override
  State<SubjectDashboardScreen> createState() => _SubjectDashboardScreenState();
}

class _SubjectDashboardScreenState extends State<SubjectDashboardScreen> {
  List<Map<String, dynamic>> _subjects = [];
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
      final data = await context.read<ApiClient>().get('/api/student/subjects');
      if (!mounted) return;
      setState(() {
        _subjects =
            ((data['subjects'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: GlassAppBar(title: Text(l10n.t('mobile.subjects.title'))),
      body: _loading
          ? SkeletonList(count: 3, itemBuilder: (_) => const SkeletonTextCard())
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
              : _subjects.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.auto_graph_rounded,
                              size: 48,
                              color: AppTheme.muted.withValues(alpha: 0.5),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              l10n.t('mobile.subjects.empty'),
                              style: const TextStyle(fontWeight: FontWeight.w600),
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
                        itemCount: _subjects.length,
                        separatorBuilder: (context, index) => const SizedBox(height: 12),
                        itemBuilder: (context, index) =>
                            _SubjectCard(entry: _subjects[index]),
                      ),
                    ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({required this.entry});

  final Map<String, dynamic> entry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final subjectId = entry['subjectId']?.toString() ?? '';
    final name = localizedSubjectName(entry['subjectName'], context.localeCode);
    final masteryScore = (entry['masteryScore'] as num?)?.round() ?? 0;
    final aiConfidenceScore = (entry['aiConfidenceScore'] as num?)?.round() ?? 0;
    final retentionScore = (entry['retentionScore'] as num?)?.round() ?? 0;
    final level = entry['performanceLevel']?.toString() ?? 'BEGINNER';
    final trend = entry['trend']?.toString() ?? 'STABLE';
    final lastComputedAt = DateTime.tryParse(entry['lastComputedAt']?.toString() ?? '');
    final levelColor = performanceLevelColor(level);

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: subjectId.isEmpty
            ? null
            : () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => SubjectDetailScreen(subjectId: subjectId),
                  ),
                ),
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
                          name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                        ),
                        const SizedBox(height: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                          decoration: BoxDecoration(
                            color: levelColor.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: levelColor.withValues(alpha: 0.4)),
                          ),
                          child: Text(
                            l10n.t('mobile.subjects.levels.$level'),
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: levelColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  CircularScoreGauge(
                    percent: masteryScore,
                    label: l10n.t('mobile.subjects.mastery'),
                    size: 76,
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _StatBox(
                      value: '$aiConfidenceScore%',
                      label: l10n.t('mobile.subjects.aiConfidence'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _StatBox(
                      value: '$retentionScore%',
                      label: l10n.t('mobile.subjects.retention'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${trendArrow(trend)} ${l10n.t('mobile.subjects.trends.$trend')}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: trendColor(trend),
                    ),
                  ),
                  if (lastComputedAt != null)
                    Text(
                      l10n.t('mobile.subjects.lastUpdated', {
                        'date':
                            '${lastComputedAt.year}-${lastComputedAt.month.toString().padLeft(2, '0')}-${lastComputedAt.day.toString().padLeft(2, '0')}',
                      }),
                      style: TextStyle(color: AppTheme.muted, fontSize: 11),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatBox extends StatelessWidget {
  const _StatBox({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.cardBorder.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(color: AppTheme.muted, fontSize: 11)),
        ],
      ),
    );
  }
}
