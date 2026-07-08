import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
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

  static const _reasonLabels = {
    'INAPPROPRIATE': 'Inappropriate content',
    'SPAM': 'Spam or misleading',
    'HARASSMENT': 'Harassment or hate',
    'COPYRIGHT': 'Copyright violation',
    'VIOLENCE': 'Violence or dangerous acts',
    'MISLEADING': 'False information',
    'OTHER': 'Other',
  };

  static const _targetLabels = {
    'SHORT_VIDEO': 'Reel',
    'STORE_COURSE': 'Course',
    'STORE_LESSON': 'Lesson',
  };

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Reports')),
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
                      const Text('No reports yet', style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      Text(
                        'Use Report on reels or courses',
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
                                      '${_targetLabels[targetType] ?? targetType} report',
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
                                _reasonLabels[reason] ?? reason,
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

  String _formatDate(DateTime dt) {
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
