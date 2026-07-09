import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

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
    final locale = context.watch<AuthProvider>().user?.locale ?? 'AR';
    final courses = _courses;
    if (courses == null) {
      return SkeletonList(itemBuilder: (_) => const SkeletonTextCard());
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
          final lessonsCount = (c['lessonsCount'] as num?)?.toInt() ??
              ((c['lessons'] as List?)?.length ?? 0);
          final subscribers = (c['subscribersCount'] as num?)?.toInt() ??
              ((c['_count'] as Map?)?['purchases'] as num?)?.toInt() ??
              0;
          final totalSec = (c['totalDurationSec'] as num?)?.toInt() ??
              (((c['lessons'] as List<dynamic>?) ?? []).fold<int>(
                0,
                (s, l) => s + (((l as Map)['durationSec'] as num?)?.toInt() ?? 0),
              ));
          final status = c['purchaseStatus']?.toString();
          final isOwnCourse = c['isOwnCourse'] == true;
          final id = c['id'].toString();
          final title = localizedText(c, locale);
          final thumbnail = c['thumbnail']?.toString();

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => CourseDetailScreen(
                    courseId: id,
                    summary: c,
                  ),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AspectRatio(
                    aspectRatio: 16 / 8,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (thumbnail != null && thumbnail.isNotEmpty)
                          CachedImage(url: thumbnail, fit: BoxFit.cover)
                        else
                          Container(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  AppTheme.primary.withValues(alpha: 0.4),
                                  AppTheme.card,
                                ],
                              ),
                            ),
                          ),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                Colors.transparent,
                                Colors.black.withValues(alpha: 0.5),
                              ],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                        ),
                        Positioned(
                          left: 10,
                          bottom: 8,
                          child: _MetaChip(
                            icon: Icons.schedule,
                            label: formatDuration(totalSec),
                          ),
                        ),
                        Positioned(
                          right: 10,
                          bottom: 8,
                          child: _MetaChip(
                            icon: Icons.play_circle_outline,
                            label: '$lessonsCount videos',
                          ),
                        ),
                        if (subscribers > 0)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 8,
                            child: Center(
                              child: _MetaChip(
                                icon: Icons.people_outline,
                                label: '${formatCount(subscribers)} subs',
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                title,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
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
                          '$teacherName ${_levelStars(level)}',
                          style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                        ),
                        if (subscribers > 0) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.people_outline, size: 14, color: AppTheme.muted),
                              const SizedBox(width: 4),
                              Text(
                                '${formatCount(subscribers)} subscriber${subscribers == 1 ? '' : 's'}',
                                style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                              ),
                            ],
                          ),
                        ],
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
                            _ when isOwnCourse => const Chip(
                                label: Text('Your course'),
                                avatar: Icon(Icons.school_outlined, size: 18, color: AppTheme.accent),
                              ),
                            _ => FilledButton(
                                onPressed: _busyId == id
                                    ? null
                                    : () {
                                        _buy(id);
                                      },
                                child: Text(_busyId == id ? 'Requesting…' : 'Buy Course'),
                              ),
                          },
                        ),
                      ],
                    ),
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

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
