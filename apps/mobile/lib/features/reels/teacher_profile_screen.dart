import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/teacher_cover_presets.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:ulearn/features/reels/teacher_reels_viewer.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/features/video/video_protection.dart';

/// Public teacher profile — cover, identity, courses & shorts.
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

class _TeacherProfileScreenState extends State<TeacherProfileScreen>
    with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _teacher;
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _shortVideos = [];
  bool _loading = true;
  String? _busyCourseId;
  late final TabController _tabCtrl;
  bool _bioExpanded = false;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this)..addListener(() {
      if (mounted) setState(() {});
    });
    VideoProtectionController.enableScreenHardening();
    _load();
  }

  @override
  void dispose() {
    VideoProtectionController.disableScreenHardening();
    _tabCtrl.dispose();
    super.dispose();
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
        SnackBar(content: Text(context.l10n.storePurchasePending)),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? context.l10n.t('student.purchaseAlreadyRequested')
                : context.l10n.t('mobile.store.purchaseFailed'),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busyCourseId = null);
    }
  }

  String _levelLabel(String level) {
    final l10n = context.l10n;
    return switch (level) {
      'MASTER' => l10n.t('mobile.home.teacherLevelMaster'),
      'EXCELLENT' => l10n.t('mobile.home.teacherLevelExcellent'),
      'GOOD' => l10n.t('mobile.home.teacherLevelGood'),
      _ => level.replaceAll('_', ' '),
    };
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.localeCode;
    final l10n = context.l10n;
    final name = _teacher?['name']?.toString() ??
        widget.initialName ??
        l10n.t('student.teacher');

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppTheme.background,
        body: _loading
            ? const _ProfileSkeleton()
            : _teacher == null
                ? _EmptyState(onRetry: _load)
                : RefreshIndicator(
                    color: AppTheme.accent,
                    backgroundColor: AppTheme.card,
                    onRefresh: _load,
                    child: NestedScrollView(
                      headerSliverBuilder: (context, innerScrolled) => [
                        SliverAppBar(
                          expandedHeight: 228,
                          pinned: true,
                          stretch: true,
                          elevation: 0,
                          scrolledUnderElevation: 0,
                          backgroundColor: AppTheme.background,
                          foregroundColor: AppTheme.foreground,
                          title: AnimatedOpacity(
                            duration: const Duration(milliseconds: 180),
                            opacity: innerScrolled ? 1 : 0,
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 17,
                              ),
                            ),
                          ),
                          flexibleSpace: FlexibleSpaceBar(
                            collapseMode: CollapseMode.pin,
                            background: _CoverHero(
                              teacher: _teacher!,
                              levelLabel: _levelLabel,
                            ),
                          ),
                        ),
                        SliverToBoxAdapter(
                          child: _IdentitySection(
                            teacher: _teacher!,
                            locale: locale,
                            bioExpanded: _bioExpanded,
                            onToggleBio: () =>
                                setState(() => _bioExpanded = !_bioExpanded),
                            levelLabel: _levelLabel,
                          ),
                        ),
                        SliverPersistentHeader(
                          pinned: true,
                          delegate: _SegmentedTabDelegate(
                            selectedIndex: _tabCtrl.index,
                            coursesCount: _courses.length,
                            shortsCount: _shortVideos.length,
                            coursesLabel: l10n.navCourses,
                            shortsLabel: l10n.t('nav.shortVideos'),
                            onSelect: (i) {
                              _tabCtrl.animateTo(i);
                              setState(() {});
                            },
                          ),
                        ),
                      ],
                      body: TabBarView(
                        controller: _tabCtrl,
                        children: [
                          _CoursesTab(
                            courses: _courses,
                            locale: locale,
                            busyCourseId: _busyCourseId,
                            onPurchase: _purchase,
                          ),
                          _ShortVideosTab(
                            videos: _shortVideos,
                            teacherId: widget.teacherId,
                            teacherName: _teacher!['name']?.toString(),
                          ),
                        ],
                      ),
                    ),
                  ),
      ),
    );
  }
}

// ─── Cover ───────────────────────────────────────────────────────────────────

class _CoverHero extends StatelessWidget {
  const _CoverHero({
    required this.teacher,
    required this.levelLabel,
  });

  final Map<String, dynamic> teacher;
  final String Function(String level) levelLabel;

  @override
  Widget build(BuildContext context) {
    final name =
        teacher['name']?.toString() ?? context.l10n.t('student.teacher');
    final level = teacher['level']?.toString() ?? '';
    final photo = resolveProfilePhotoUrl(teacher);
    final preset = (teacher['profileCoverPreset'] as num?)?.toInt();

    return Stack(
      fit: StackFit.expand,
      clipBehavior: Clip.none,
      children: [
        TeacherCoverBanner(preset: preset),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.center,
              colors: [
                Color(0x66000000),
                Color(0x00000000),
              ],
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 120,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppTheme.background.withValues(alpha: 0),
                  AppTheme.background.withValues(alpha: 0.92),
                  AppTheme.background,
                ],
              ),
            ),
          ),
        ),
        Positioned(
          left: 20,
          right: 20,
          bottom: 12,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              ProfileAvatar(
                name: name,
                photoUrl: photo,
                size: 84,
                cacheVersion:
                    '${teacher['id']}_${teacher['profilePhotoKey'] ?? photo ?? ''}',
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.3,
                          height: 1.15,
                          color: AppTheme.foreground,
                        ),
                      ),
                      if (level.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        _LevelBadge(label: levelLabel(level), level: level),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Identity ────────────────────────────────────────────────────────────────

class _IdentitySection extends StatelessWidget {
  const _IdentitySection({
    required this.teacher,
    required this.locale,
    required this.bioExpanded,
    required this.onToggleBio,
    required this.levelLabel,
  });

  final Map<String, dynamic> teacher;
  final String locale;
  final bool bioExpanded;
  final VoidCallback onToggleBio;
  final String Function(String level) levelLabel;

  @override
  Widget build(BuildContext context) {
    final bio = (teacher['bio'] as String?)?.trim() ?? '';
    final rating = (teacher['rating'] as num?)?.toDouble();
    final ratingCount = (teacher['ratingCount'] as num?)?.toInt() ?? 0;
    final subjects = ((teacher['subjects'] as List<dynamic>?) ?? [])
        .cast<Map<String, dynamic>>();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (rating != null && rating > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _RatingPill(rating: rating, count: ratingCount),
            ),
          if (bio.isNotEmpty) ...[
            GestureDetector(
              onTap: bio.length > 140 ? onToggleBio : null,
              child: AnimatedSize(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                alignment: Alignment.topLeft,
                child: Text(
                  bio,
                  maxLines: bioExpanded ? 20 : 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.muted.withValues(alpha: 0.95),
                    height: 1.45,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
          if (subjects.isNotEmpty) ...[
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: subjects
                  .map(
                    (s) => _SpecialtyChip(
                      label: localizedText(s, locale, prefix: 'name'),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 10),
          ],
          _StatsStrip(teacher: teacher),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _LevelBadge extends StatelessWidget {
  const _LevelBadge({required this.label, required this.level});

  final String label;
  final String level;

  @override
  Widget build(BuildContext context) {
    final accent = switch (level) {
      'MASTER' => const Color(0xFFFBBF24),
      'EXCELLENT' => AppTheme.accent,
      'GOOD' => const Color(0xFF34D399),
      _ => AppTheme.primary,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            switch (level) {
              'MASTER' => Icons.workspace_premium_rounded,
              'EXCELLENT' => Icons.military_tech_rounded,
              'GOOD' => Icons.thumb_up_alt_rounded,
              _ => Icons.school_rounded,
            },
            size: 14,
            color: accent,
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: accent,
              fontWeight: FontWeight.w700,
              fontSize: 12,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}

class _RatingPill extends StatelessWidget {
  const _RatingPill({required this.rating, required this.count});

  final double rating;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.star_rounded, size: 15, color: Color(0xFFFBBF24)),
          const SizedBox(width: 4),
          Text(
            rating.toStringAsFixed(1),
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
              color: AppTheme.foreground,
            ),
          ),
          if (count > 0) ...[
            const SizedBox(width: 4),
            Text(
              '($count)',
              style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _SpecialtyChip extends StatelessWidget {
  const _SpecialtyChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.18),
            AppTheme.accent.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.22)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
          color: AppTheme.foreground,
        ),
      ),
    );
  }
}

class _StatsStrip extends StatelessWidget {
  const _StatsStrip({required this.teacher});

  final Map<String, dynamic> teacher;

  String _fmt(num? n) {
    final v = (n ?? 0).toInt();
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return '$v';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final items = [
      _StatItem(
        value: '${teacher['liveCoursesCount'] ?? 0}',
        label: l10n.navCourses,
      ),
      _StatItem(
        value: '${teacher['reelsCount'] ?? 0}',
        label: l10n.reelsTitle,
      ),
      _StatItem(
        value: _fmt(teacher['subscriptionsCount'] as num?),
        label: l10n.navSubscriptions,
      ),
      _StatItem(
        value: _fmt(teacher['totalLikesCount'] as num?),
        label: l10n.t('mobile.reels.totalLikes'),
      ),
    ];

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0)
              Container(
                width: 1,
                height: 24,
                color: AppTheme.cardBorder,
              ),
            Expanded(child: items[i]),
          ],
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 17,
            letterSpacing: -0.3,
            color: AppTheme.foreground,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppTheme.muted,
            fontSize: 10.5,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

class _SegmentedTabDelegate extends SliverPersistentHeaderDelegate {
  _SegmentedTabDelegate({
    required this.selectedIndex,
    required this.coursesCount,
    required this.shortsCount,
    required this.coursesLabel,
    required this.shortsLabel,
    required this.onSelect,
  });

  final int selectedIndex;
  final int coursesCount;
  final int shortsCount;
  final String coursesLabel;
  final String shortsLabel;
  final ValueChanged<int> onSelect;

  @override
  double get minExtent => 58;

  @override
  double get maxExtent => 58;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Material(
      color: AppTheme.background,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
        child: Container(
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppTheme.cardBorder),
          ),
          child: Row(
            children: [
              Expanded(
                child: _SegTab(
                  icon: Icons.menu_book_rounded,
                  count: coursesCount,
                  selected: selectedIndex == 0,
                  onTap: () => onSelect(0),
                ),
              ),
              Expanded(
                child: _SegTab(
                  icon: Icons.movie_filter_rounded,
                  count: shortsCount,
                  selected: selectedIndex == 1,
                  onTap: () => onSelect(1),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _SegmentedTabDelegate oldDelegate) =>
      oldDelegate.selectedIndex != selectedIndex ||
      oldDelegate.coursesCount != coursesCount ||
      oldDelegate.shortsCount != shortsCount;
}

class _SegTab extends StatelessWidget {
  const _SegTab({
    required this.icon,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOutCubic,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(11),
        gradient: selected ? AppTheme.gradient : null,
        boxShadow: selected
            ? [
                BoxShadow(
                  color: AppTheme.primary.withValues(alpha: 0.35),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(11),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: selected ? Colors.white : AppTheme.muted,
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: selected
                        ? Colors.white.withValues(alpha: 0.22)
                        : AppTheme.background,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: selected ? Colors.white : AppTheme.muted,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Courses ─────────────────────────────────────────────────────────────────

class _CoursesTab extends StatelessWidget {
  const _CoursesTab({
    required this.courses,
    required this.locale,
    required this.busyCourseId,
    required this.onPurchase,
  });

  final List<Map<String, dynamic>> courses;
  final String locale;
  final String? busyCourseId;
  final Future<void> Function(String courseId) onPurchase;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return CustomScrollView(
      key: const PageStorageKey<String>('teacher_profile_courses'),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          sliver: courses.isEmpty
              ? SliverToBoxAdapter(
                  child: _EmptyPanel(
                    icon: Icons.menu_book_outlined,
                    message: l10n.t('mobile.reels.noLiveCourses'),
                  ),
                )
              : SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      if (index == 0) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(
                            l10n.storeSubscribeUnlock,
                            style: TextStyle(
                              color: AppTheme.muted.withValues(alpha: 0.9),
                              fontSize: 13,
                              height: 1.35,
                            ),
                          ),
                        );
                      }
                      final c = courses[index - 1];
                      return StaggeredItem(
                        index: index - 1,
                        child: _CourseCard(
                          course: c,
                          locale: locale,
                          busy: busyCourseId == c['id']?.toString(),
                          onOpen: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => CourseDetailScreen(
                                courseId: c['id'].toString(),
                                summary: c,
                              ),
                            ),
                          ),
                          onPurchase: () => onPurchase(c['id'].toString()),
                        ),
                      );
                    },
                    childCount: courses.isEmpty ? 0 : courses.length + 1,
                  ),
                ),
        ),
      ],
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
    final l10n = context.l10n;
    final title = localizedText(course, locale);
    final price = course['price'];
    final currency = course['currency']?.toString() ?? 'IQD';
    final status = course['purchaseStatus']?.toString();
    final isOwnCourse = course['isOwnCourse'] == true;
    final lessons = (course['lessonsCount'] as num?)?.toInt() ??
        ((course['lessons'] as List?)?.length ?? 0);
    final subscribers = (course['subscribersCount'] as num?)?.toInt() ??
        ((course['_count'] as Map?)?['purchases'] as num?)?.toInt() ??
        0;
    final duration = formatDuration((course['totalDurationSec'] as num?)?.toInt() ?? 0);
    final subject = course['subject'] as Map<String, dynamic>?;
    final stage = course['stage'] as Map<String, dynamic>?;
    final thumb = course['thumbnail']?.toString();
    final id = course['id']?.toString() ?? title;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onOpen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (thumb != null && thumb.isNotEmpty)
                      Hero(
                        tag: 'teacher-course-$id',
                        child: CachedImage(
                          url: thumb,
                          fit: BoxFit.cover,
                          cacheVersion: course['updatedAt']?.toString(),
                          placeholder: const _ThumbFallback(),
                          error: const _ThumbFallback(),
                        ),
                      )
                    else
                      const _ThumbFallback(),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Color(0x00000000),
                            Color(0x99000000),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      left: 12,
                      bottom: 12,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Text(
                          '$price $currency',
                          style: const TextStyle(
                            color: AppTheme.accent,
                            fontWeight: FontWeight.w800,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                    if (lessons > 0)
                      Positioned(
                        right: 12,
                        bottom: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.play_circle_outline,
                                  size: 14, color: Colors.white70),
                              const SizedBox(width: 4),
                              Text(
                                l10n.homeLessons(lessons),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16.5,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (subject != null)
                          _MetaChip(
                            icon: Icons.subject_rounded,
                            label: localizedText(subject, locale, prefix: 'name'),
                          ),
                        if (stage != null)
                          _MetaChip(
                            icon: Icons.layers_outlined,
                            label: localizedText(stage, locale, prefix: 'name'),
                          ),
                        if (duration.isNotEmpty)
                          _MetaChip(icon: Icons.schedule_rounded, label: duration),
                        if (subscribers > 0)
                          _MetaChip(
                            icon: Icons.people_outline_rounded,
                            label: l10n.homeSubscribers(subscribers),
                          ),
                      ],
                    ),
                    if (course['description'] != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        course['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppTheme.muted,
                          fontSize: 13,
                          height: 1.4,
                        ),
                      ),
                    ],
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      height: 44,
                      child: switch (status) {
                        'PAID' => FilledButton.icon(
                            onPressed: onOpen,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppTheme.accent,
                              foregroundColor: Colors.black,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            icon: const Icon(Icons.play_circle_outline, size: 18),
                            label: Text(l10n.reelsSubscribedWatch),
                          ),
                        'PENDING' => OutlinedButton.icon(
                            onPressed: null,
                            style: OutlinedButton.styleFrom(
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            icon: const Icon(Icons.hourglass_top, size: 18),
                            label: Text(l10n.homeAwaitingPayment),
                          ),
                        _ when isOwnCourse => OutlinedButton.icon(
                            onPressed: onOpen,
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppTheme.accent,
                              side: BorderSide(
                                color: AppTheme.accent.withValues(alpha: 0.5),
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            icon: const Icon(Icons.school_outlined, size: 18),
                            label: Text(l10n.reelsYourCourseOpen),
                          ),
                        _ => FilledButton(
                            onPressed: busy ? null : onPurchase,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: Text(
                              busy
                                  ? l10n.quizSubmitting
                                  : l10n.t('mobile.reels.subscribeBuy'),
                            ),
                          ),
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
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
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppTheme.muted),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: AppTheme.muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _ThumbFallback extends StatelessWidget {
  const _ThumbFallback();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.4),
            AppTheme.card,
            AppTheme.accent.withValues(alpha: 0.15),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Icon(Icons.menu_book_rounded, color: Colors.white38, size: 40),
      ),
    );
  }
}

// ─── Shorts ──────────────────────────────────────────────────────────────────

class _ShortVideosTab extends StatelessWidget {
  const _ShortVideosTab({
    required this.videos,
    required this.teacherId,
    this.teacherName,
  });

  final List<Map<String, dynamic>> videos;
  final String teacherId;
  final String? teacherName;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return CustomScrollView(
      key: const PageStorageKey<String>('teacher_profile_shorts'),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          sliver: videos.isEmpty
              ? SliverToBoxAdapter(
                  child: _EmptyPanel(
                    icon: Icons.movie_filter_outlined,
                    message: l10n.reelsNoReels,
                  ),
                )
              : SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 6,
                    mainAxisSpacing: 6,
                    childAspectRatio: 9 / 14,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => StaggeredItem(
                      index: index.clamp(0, 8),
                      child: _ShortVideoTile(
                        video: videos[index],
                        videos: videos,
                        index: index,
                        teacherId: teacherId,
                        teacherName: teacherName,
                      ),
                    ),
                    childCount: videos.length,
                  ),
                ),
        ),
      ],
    );
  }
}

class _ShortVideoTile extends StatelessWidget {
  const _ShortVideoTile({
    required this.video,
    required this.videos,
    required this.index,
    required this.teacherId,
    this.teacherName,
  });

  final Map<String, dynamic> video;
  final List<Map<String, dynamic>> videos;
  final int index;
  final String teacherId;
  final String? teacherName;

  String _formatViews(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  @override
  Widget build(BuildContext context) {
    final views = (video['viewCount'] as num?)?.toInt() ?? 0;
    final thumb = video['thumbnailUrl']?.toString();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
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
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.cardBorder.withValues(alpha: 0.6)),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (thumb != null && thumb.isNotEmpty)
                  CachedImage(
                    url: thumb,
                    fit: BoxFit.cover,
                    placeholder: _thumbFallback(),
                    error: _thumbFallback(),
                  )
                else
                  _thumbFallback(),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Color(0x00000000), Color(0xCC000000)],
                      begin: Alignment.center,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                ),
                Center(
                  child: Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.black.withValues(alpha: 0.35),
                      border: Border.all(color: Colors.white38),
                    ),
                    child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 22),
                  ),
                ),
                Positioned(
                  left: 6,
                  right: 6,
                  bottom: 6,
                  child: Row(
                    children: [
                      const Icon(Icons.visibility_rounded, color: Colors.white70, size: 12),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          _formatViews(views),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _thumbFallback() {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.5),
            AppTheme.card,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
    );
  }
}

// ─── Empty / skeleton ────────────────────────────────────────────────────────

class _EmptyPanel extends StatelessWidget {
  const _EmptyPanel({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, size: 40, color: AppTheme.muted.withValues(alpha: 0.7)),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.muted, height: 1.45),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.card,
                border: Border.all(color: AppTheme.cardBorder),
              ),
              child: Icon(Icons.person_off_outlined, size: 32, color: AppTheme.muted),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.reelsTeacherNotFound,
              style: TextStyle(
                color: AppTheme.muted,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: Text(l10n.retry),
            ),
          ],
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
        padding: EdgeInsets.zero,
        children: [
          const SkeletonBox(height: 188, radius: 0),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Transform.translate(
                  offset: const Offset(0, -36),
                  child: const Align(
                    alignment: Alignment.centerLeft,
                    child: SkeletonBox(height: 92, width: 92, radius: 46),
                  ),
                ),
                const SizedBox(height: 20),
                const SkeletonLine(width: 200),
                const SizedBox(height: 10),
                const SkeletonLine(width: 140),
                const SizedBox(height: 16),
                const SkeletonLine(width: double.infinity),
                const SizedBox(height: 6),
                const SkeletonLine(width: 260),
                const SizedBox(height: 18),
                const SkeletonBox(height: 64, radius: 18),
                const SizedBox(height: 16),
                const SkeletonBox(height: 48, radius: 14),
                const SizedBox(height: 16),
                const SkeletonBox(height: 180, radius: 20),
                const SizedBox(height: 12),
                const SkeletonBox(height: 180, radius: 20),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
