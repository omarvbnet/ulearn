import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/core/widgets/teacher_cover_presets.dart';
import 'package:ulearn/features/reels/teacher_reels_viewer.dart';

/// Teacher public profile from reels — live courses available to purchase.
class TeacherProfileScreen extends StatefulWidget {
  const TeacherProfileScreen({
    super.key,
    required this.teacherId,
    this.initialName,
  });

  final String teacherId;
  final String? initialName;

  @override
  State<TeacherProfileScreen> createState() => _TeacherProfileScreenState();
}

class _TeacherProfileScreenState extends State<TeacherProfileScreen> {
  Map<String, dynamic>? _teacher;
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _shortVideos = [];
  bool _loading = true;
  String? _busyCourseId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data =
          await context.read<ApiClient>().get('/api/store/teachers/${widget.teacherId}');
      if (!mounted) return;
      setState(() {
        _teacher = data['teacher'] as Map<String, dynamic>?;
        _courses = ((data['courses'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _shortVideos =
            ((data['shortVideos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _purchase(String courseId) async {
    setState(() => _busyCourseId = courseId);
    try {
      await context.read<ApiClient>().post('/api/store/courses/$courseId/purchase', {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Purchase requested — payment confirmation pending')),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? 'You already requested this course'
                : 'Could not request purchase',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busyCourseId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<AuthProvider>().user?.locale ?? 'AR';

    return Scaffold(
      body: _loading
          ? const _ProfileSkeleton()
          : _teacher == null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.person_off_outlined, size: 48, color: AppTheme.muted),
                      const SizedBox(height: 12),
                      const Text('Teacher not found', style: TextStyle(color: AppTheme.muted)),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(
                    slivers: [
                      SliverAppBar(
                        expandedHeight: 220,
                        pinned: true,
                        stretch: true,
                        backgroundColor: AppTheme.background,
                        flexibleSpace: FlexibleSpaceBar(
                          background: Stack(
                            fit: StackFit.expand,
                            children: [
                              TeacherCoverBanner(
                                preset: (_teacher!['profileCoverPreset'] as num?)?.toInt(),
                              ),
                              Positioned(
                                bottom: 24,
                                left: 20,
                                right: 20,
                                child: _HeaderCard(teacher: _teacher!, locale: locale),
                              ),
                            ],
                          ),
                        ),
                      ),
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        sliver: SliverList(
                          delegate: SliverChildListDelegate([
                            if ((_teacher!['bio'] as String?)?.isNotEmpty == true) ...[
                              Text(
                                _teacher!['bio'].toString(),
                                style: const TextStyle(color: AppTheme.muted, height: 1.5),
                              ),
                              const SizedBox(height: 16),
                            ],
                            _StatsRow(teacher: _teacher!),
                            const SizedBox(height: 20),
                            if (_shortVideos.isNotEmpty) ...[
                              Row(
                                children: [
                                  const Text(
                                    'Short videos',
                                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppTheme.primary.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      '${_shortVideos.length}',
                                      style: const TextStyle(
                                        color: AppTheme.accent,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              _ShortVideosGrid(
                                videos: _shortVideos,
                                teacherId: widget.teacherId,
                                teacherName: _teacher!['name']?.toString(),
                              ),
                              const SizedBox(height: 24),
                            ],
                            Row(
                              children: [
                                const Text(
                                  'Live courses',
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppTheme.accent.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    '${_courses.length}',
                                    style: const TextStyle(
                                      color: AppTheme.accent,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Subscribe by purchasing a course — unlock all lessons after payment confirmation.',
                              style: TextStyle(
                                color: AppTheme.muted.withValues(alpha: 0.9),
                                fontSize: 13,
                                height: 1.4,
                              ),
                            ),
                            const SizedBox(height: 14),
                            if (_courses.isEmpty)
                              Container(
                                padding: const EdgeInsets.all(20),
                                decoration: BoxDecoration(
                                  color: AppTheme.card,
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(color: AppTheme.cardBorder),
                                ),
                                child: const Center(
                                  child: Text(
                                    'No live courses yet.\nCheck back soon!',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: AppTheme.muted),
                                  ),
                                ),
                              )
                            else
                              ..._courses.asMap().entries.map((e) {
                                final c = e.value;
                                return StaggeredItem(
                                  index: e.key,
                                  child: _CourseCard(
                                    course: c,
                                    locale: locale,
                                    busy: _busyCourseId == c['id']?.toString(),
                                    onOpen: () => Navigator.of(context).push(
                                      MaterialPageRoute(
                                        builder: (_) => CourseDetailScreen(
                                          courseId: c['id'].toString(),
                                          summary: c,
                                        ),
                                      ),
                                    ),
                                    onPurchase: () => _purchase(c['id'].toString()),
                                  ),
                                );
                              }),
                          ]),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.teacher, required this.locale});

  final Map<String, dynamic> teacher;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final name = teacher['name']?.toString() ?? 'Teacher';
    final level = teacher['level']?.toString() ?? '';
    final rating = (teacher['rating'] as num?)?.toDouble();
    final ratingCount = (teacher['ratingCount'] as num?)?.toInt() ?? 0;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        ProfileAvatar(
          name: name,
          photoUrl: teacher['profilePhotoUrl']?.toString(),
          size: 72,
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
              if (level.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  level.replaceAll('_', ' '),
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ],
              if (rating != null && rating > 0) ...[
                const SizedBox(height: 4),
                Text(
                  '${rating.toStringAsFixed(1)} ★ · $ratingCount reviews',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.teacher});

  final Map<String, dynamic> teacher;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatChip(
          icon: Icons.play_lesson_outlined,
          label: '${teacher['liveCoursesCount'] ?? 0}',
          caption: 'Courses',
        ),
        const SizedBox(width: 10),
        _StatChip(
          icon: Icons.movie_outlined,
          label: '${teacher['reelsCount'] ?? 0}',
          caption: 'Reels',
        ),
      ],
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.icon, required this.label, required this.caption});

  final IconData icon;
  final String label;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppTheme.cardBorder),
        ),
        child: Row(
          children: [
            Icon(icon, color: AppTheme.accent, size: 22),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text(caption, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CourseCard extends StatelessWidget {
  const _CourseCard({
    required this.course,
    required this.locale,
    required this.busy,
    required this.onOpen,
    required this.onPurchase,
  });

  final Map<String, dynamic> course;
  final String locale;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onPurchase;

  @override
  Widget build(BuildContext context) {
    final title = localizedText(course, locale);
    final price = course['price'];
    final currency = course['currency']?.toString() ?? 'IQD';
    final status = course['purchaseStatus']?.toString();
    final isOwnCourse = course['isOwnCourse'] == true;
    final lessons = (course['lessonsCount'] as num?)?.toInt() ??
        ((course['lessons'] as List?)?.length ?? 0);
    final duration = formatDuration((course['totalDurationSec'] as num?)?.toInt() ?? 0);
    final subject = course['subject'] as Map<String, dynamic>?;
    final stage = course['stage'] as Map<String, dynamic>?;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Text(
                      '$price $currency',
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    if (subject != null) localizedText(subject, locale, prefix: 'name'),
                    if (stage != null) localizedText(stage, locale, prefix: 'name'),
                    '$lessons lessons',
                    duration,
                  ].where((s) => s.isNotEmpty).join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                if (course['description'] != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    course['description'].toString(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.35),
                  ),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: switch (status) {
                    'PAID' => FilledButton.icon(
                        onPressed: onOpen,
                        icon: const Icon(Icons.play_circle_outline, size: 18),
                        label: const Text('Subscribed — watch in My Courses'),
                      ),
                    'PENDING' => OutlinedButton.icon(
                        onPressed: null,
                        icon: const Icon(Icons.hourglass_top, size: 18),
                        label: const Text('Awaiting payment confirmation'),
                      ),
                    _ when isOwnCourse => OutlinedButton.icon(
                        onPressed: onOpen,
                        icon: const Icon(Icons.school_outlined, size: 18),
                        label: const Text('Your course — open'),
                      ),
                    _ => FilledButton(
                        onPressed: busy
                            ? null
                            : () {
                                onPurchase();
                              },
                        child: Text(busy ? 'Requesting…' : 'Subscribe / Buy course'),
                      ),
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileSkeleton extends StatelessWidget {
  const _ProfileSkeleton();

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SkeletonBox(height: 180, radius: 16),
          SizedBox(height: 16),
          SkeletonLine(width: double.infinity),
          SizedBox(height: 8),
          SkeletonLine(width: 220),
          SizedBox(height: 20),
          SkeletonTextCard(),
          SizedBox(height: 12),
          SkeletonTextCard(),
        ],
      ),
    );
  }
}

class _ShortVideosGrid extends StatelessWidget {
  const _ShortVideosGrid({
    required this.videos,
    required this.teacherId,
    this.teacherName,
  });

  final List<Map<String, dynamic>> videos;
  final String teacherId;
  final String? teacherName;

  String _formatViews(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 9 / 14,
      ),
      itemCount: videos.length,
      itemBuilder: (context, index) {
        final video = videos[index];
        final views = (video['viewCount'] as num?)?.toInt() ?? 0;
        final thumb = video['thumbnailUrl']?.toString();

        return GestureDetector(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TeacherReelsViewer(
                videos: videos,
                initialIndex: index,
                teacherId: teacherId,
                teacherName: teacherName,
              ),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (thumb != null && thumb.isNotEmpty)
                  Image.network(
                    thumb,
                    fit: BoxFit.cover,
                    errorBuilder: (_, e, st) => _thumbFallback(),
                  )
                else
                  _thumbFallback(),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.75)],
                      begin: Alignment.center,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                ),
                const Center(
                  child: Icon(Icons.play_circle_fill, color: Colors.white70, size: 36),
                ),
                Positioned(
                  left: 6,
                  bottom: 6,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.visibility_outlined, color: Colors.white, size: 12),
                      const SizedBox(width: 3),
                      Text(
                        _formatViews(views),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _thumbFallback() {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.45),
            AppTheme.card,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
    );
  }
}
