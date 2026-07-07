import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Paid teacher courses store. Purchases are requested in-app and
/// unlocked once the admin confirms the payment.
class StoreScreen extends StatefulWidget {
  const StoreScreen({super.key});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  List<dynamic>? _courses;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/store/courses');
      if (!mounted) return;
      setState(() => _courses = data['courses'] as List<dynamic>? ?? []);
    } catch (_) {
      if (mounted) setState(() => _courses = []);
    }
  }

  Future<void> _buy(String id) async {
    setState(() => _busyId = id);
    try {
      await context.read<ApiClient>().post('/api/store/courses/$id/purchase', {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Purchase requested — we\'ll confirm your payment shortly'),
        ),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? 'You already requested this course'
                : 'Failed to request purchase',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  String _levelStars(String? level) => switch (level) {
        'MASTER' => '★★★',
        'EXCELLENT' => '★★',
        'GOOD' => '★',
        _ => '',
      };

  @override
  Widget build(BuildContext context) {
    final courses = _courses;
    if (courses == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (courses.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No courses available yet.\nTeacher courses appear here once approved.',
            style: TextStyle(color: AppTheme.muted),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: courses.length,
        itemBuilder: (context, i) {
          final c = courses[i] as Map<String, dynamic>;
          final teacher = c['teacher'] as Map<String, dynamic>?;
          final teacherName =
              (teacher?['user'] as Map<String, dynamic>?)?['fullLegalName']?.toString() ?? '';
          final level = teacher?['level']?.toString();
          final lessons = (c['lessons'] as List?)?.length ?? 0;
          final status = c['purchaseStatus']?.toString();
          final id = c['id'].toString();

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          c['titleAr']?.toString() ?? c['titleEn']?.toString() ?? 'Course',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                      ),
                      Text(
                        '${c['price']} ${c['currency'] ?? 'IQD'}',
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '$teacherName ${_levelStars(level)} · $lessons lessons',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
                  if (c['description'] != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      c['description'].toString(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: switch (status) {
                      'PAID' => const Chip(
                          label: Text('Purchased'),
                          avatar: Icon(Icons.check_circle, size: 18, color: Colors.green),
                        ),
                      'PENDING' => const Chip(
                          label: Text('Awaiting payment confirmation'),
                          avatar: Icon(Icons.hourglass_top, size: 18),
                        ),
                      _ => FilledButton(
                          onPressed: _busyId == id ? null : () => _buy(id),
                          child: Text(_busyId == id ? 'Requesting…' : 'Buy Course'),
                        ),
                    },
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
