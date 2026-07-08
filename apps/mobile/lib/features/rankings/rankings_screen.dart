import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

class RankingsScreen extends StatefulWidget {
  const RankingsScreen({super.key});

  @override
  State<RankingsScreen> createState() => _RankingsScreenState();
}

class _RankingsScreenState extends State<RankingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  Map<String, dynamic>? _data;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/rankings');
      if (mounted) setState(() { _data = data; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return SkeletonList(
        count: 8,
        itemBuilder: (_) => const SkeletonListTile(),
      );
    }

    return Column(
      children: [
        TabBar(
          controller: _tabs,
          indicatorColor: AppTheme.accent,
          labelColor: AppTheme.foreground,
          unselectedLabelColor: AppTheme.muted,
          tabs: const [
            Tab(text: 'Top Learners'),
            Tab(text: 'Quiz Scores'),
            Tab(text: 'Most Active'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _RankList(
                entries: _list('topStudents'),
                valueOf: (e) => _formatWatch((e['watchSec'] as num?)?.toInt() ?? 0),
              ),
              _RankList(
                entries: _list('highestScores'),
                valueOf: (e) => '${((e['avgScore'] as num?) ?? 0).toStringAsFixed(0)}%',
              ),
              _RankList(
                entries: _list('mostActive'),
                valueOf: (e) => '${e['activityScore'] ?? 0} pts',
              ),
            ],
          ),
        ),
      ],
    );
  }

  List<Map<String, dynamic>> _list(String key) =>
      ((_data?[key] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  static String _formatWatch(int sec) {
    final h = sec ~/ 3600;
    final m = (sec % 3600) ~/ 60;
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }
}

class _RankList extends StatelessWidget {
  const _RankList({required this.entries, required this.valueOf});

  final List<Map<String, dynamic>> entries;
  final String Function(Map<String, dynamic>) valueOf;

  static const _medalColors = [
    Color(0xFFFFD700),
    Color(0xFFC0C0C0),
    Color(0xFFCD7F32),
  ];

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const Center(
        child: Text('No rankings yet', style: TextStyle(color: AppTheme.muted)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: entries.length,
      itemBuilder: (context, i) {
        final e = entries[i];
        final rank = (e['rank'] as num?)?.toInt() ?? i + 1;
        final isTop3 = rank <= 3;

        return StaggeredItem(
          index: i,
          child: Card(
            margin: const EdgeInsets.only(bottom: 10),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: isTop3
                    ? _medalColors[rank - 1].withValues(alpha: 0.5)
                    : AppTheme.cardBorder,
              ),
            ),
            child: ListTile(
              leading: isTop3
                  ? ScaleIn(
                      delayMs: rank * 100,
                      child: CircleAvatar(
                        backgroundColor: _medalColors[rank - 1].withValues(alpha: 0.2),
                        child: Text(
                          rank == 1 ? '🥇' : rank == 2 ? '🥈' : '🥉',
                          style: const TextStyle(fontSize: 18),
                        ),
                      ),
                    )
                  : CircleAvatar(
                      backgroundColor: AppTheme.cardBorder,
                      child: Text(
                        '$rank',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                      ),
                    ),
              title: Text(e['name']?.toString() ?? 'User'),
              trailing: Text(
                valueOf(e),
                style: const TextStyle(
                  color: AppTheme.accent,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
