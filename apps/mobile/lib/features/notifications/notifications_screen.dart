import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/notifications');
      if (mounted) {
        setState(() {
          _items = ((data['notifications'] as List<dynamic>?) ?? [])
              .cast<Map<String, dynamic>>();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markRead(String id) async {
    try {
      await context.read<ApiClient>().post('/api/notifications', {'id': id});
      setState(() {
        final idx = _items.indexWhere((n) => n['id'] == id);
        if (idx >= 0) _items[idx]['isRead'] = true;
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return SkeletonList(
        count: 7,
        itemBuilder: (_) => const SkeletonListTile(hasTrailing: false),
      );
    }

    if (_items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.notifications_none, size: 48, color: AppTheme.muted),
            const SizedBox(height: 12),
            Text(
              context.l10n.studentNoNotifications,
              style: const TextStyle(color: AppTheme.muted),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppTheme.accent,
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _items.length,
        itemBuilder: (context, i) {
          final n = _items[i];
          final isRead = n['isRead'] == true;
          return StaggeredItem(
            index: i,
            child: Card(
              margin: const EdgeInsets.only(bottom: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: isRead
                      ? AppTheme.cardBorder
                      : AppTheme.accent.withValues(alpha: 0.4),
                ),
              ),
              child: ListTile(
                onTap: isRead ? null : () => _markRead(n['id'] as String),
                leading: Icon(
                  isRead ? Icons.drafts_outlined : Icons.mark_email_unread_outlined,
                  color: isRead ? AppTheme.muted : AppTheme.accent,
                ),
                title: Text(
                  n['title']?.toString() ?? '',
                  style: TextStyle(
                    fontWeight: isRead ? FontWeight.normal : FontWeight.bold,
                  ),
                ),
                subtitle: Text(
                  n['body']?.toString() ?? '',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
