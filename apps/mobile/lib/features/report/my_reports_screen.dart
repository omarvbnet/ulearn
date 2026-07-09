import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({super.key});

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  List<Map<String, dynamic>> _reports = [];
  bool _loading = true;

  static const _statusColors = {
    'PENDING': Colors.orangeAccent,
    'REVIEWED': AppTheme.accent,
    'DISMISSED': AppTheme.muted,
    'ACTION_TAKEN': Colors.greenAccent,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await context.read<ApiClient>().get('/api/reports');
      if (!mounted) return;
      setState(() {
        _reports = ((data['reports'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _reasonLabel(String reason) =>
      context.l10n.t('mobile.report.reasons.$reason');

  String _targetLabel(String targetType) =>
      context.l10n.t('mobile.report.targets.$targetType');

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileMyReports)),
      body: _loading
          ? const Padding(
              padding: EdgeInsets.all(16),
              child: SkeletonBox(height: 80, radius: 12),
            )
          : _reports.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.flag_outlined, size: 48, color: AppTheme.muted.withValues(alpha: 0.5)),
                      const SizedBox(height: 12),
                      Text(l10n.reportNoReports, style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      Text(
                        l10n.reportNoReportsHint,
                        style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85)),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _reports.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final r = _reports[index];
                      final reason = r['reason']?.toString() ?? '';
                      final targetType = r['targetType']?.toString() ?? '';
                      final status = r['status']?.toString() ?? 'PENDING';
                      final created = DateTime.tryParse(r['createdAt']?.toString() ?? '');

                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      l10n.t('mobile.report.reportTitle', {
                                        'target': _targetLabel(targetType),
                                      }),
                                      style: const TextStyle(fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: (_statusColors[status] ?? AppTheme.muted).withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      status.replaceAll('_', ' '),
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: _statusColors[status] ?? AppTheme.muted,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(
                                _reasonLabelsContains(reason) ? _reasonLabel(reason) : reason,
                                style: const TextStyle(color: AppTheme.accent, fontSize: 13),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                r['details']?.toString() ?? '',
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: AppTheme.muted, height: 1.35),
                              ),
                              if (created != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  _formatDate(created),
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                                ),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  bool _reasonLabelsContains(String reason) => const {
        'INAPPROPRIATE',
        'SPAM',
        'HARASSMENT',
        'COPYRIGHT',
        'VIOLENCE',
        'MISLEADING',
        'OTHER',
      }.contains(reason);

  String _formatDate(DateTime dt) {
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
