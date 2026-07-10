import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/teacher_course_manage_screen.dart';
import 'package:ulearn/features/store/teacher_course_wizard_screen.dart';
import 'package:ulearn/features/store/teacher_lesson_upload_screen.dart';

/// Professional courses hub for Teacher Studio (replaces the old Videos tab).
class TeacherCoursesTab extends StatefulWidget {
  const TeacherCoursesTab({
    super.key,
    required this.courses,
    required this.onRefresh,
  });

  final List<Map<String, dynamic>> courses;
  final Future<void> Function() onRefresh;

  @override
  State<TeacherCoursesTab> createState() => _TeacherCoursesTabState();
}

class _TeacherCoursesTabState extends State<TeacherCoursesTab> {
  String _filter = 'ALL';

  List<Map<String, dynamic>> get _filtered {
    if (_filter == 'ALL') return widget.courses;
    if (_filter == 'REVIEW') {
      return widget.courses
          .where((c) {
            final s = c['status']?.toString() ?? '';
            return s == 'PENDING_REVIEW' || s == 'REJECTED';
          })
          .toList();
    }
    return widget.courses
        .where((c) => (c['status']?.toString() ?? '') == _filter)
        .toList();
  }

  int _countExact(String status) => widget.courses
      .where((c) => (c['status']?.toString() ?? '') == status)
      .length;

  int get _reviewCount =>
      _countExact('PENDING_REVIEW') + _countExact('REJECTED');

  Future<void> _openManage(String courseId) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TeacherCourseManageScreen(courseId: courseId),
      ),
    );
    await widget.onRefresh();
  }

  Future<void> _openUpload(Map<String, dynamic> course) async {
    final id = course['id']?.toString();
    if (id == null) return;
    final title = course['titleEn']?.toString() ??
        course['title']?.toString() ??
        context.l10n.t('mobile.teacher.manageCourse');
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TeacherLessonUploadScreen(
          courseId: id,
          courseTitle: title,
        ),
      ),
    );
    await widget.onRefresh();
  }

  Future<void> _openWizard({String? courseId}) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TeacherCourseWizardScreen(courseId: courseId),
      ),
    );
    await widget.onRefresh();
  }

  Future<void> _submit(String courseId) async {
    final l10n = context.l10n;
    try {
      await context.read<ApiClient>().post(
        '/api/teacher/courses/$courseId/submit',
        {},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.teacher.submittedForReview'))),
      );
      await widget.onRefresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;
    final filtered = _filtered;

    return RefreshIndicator(
      color: AppTheme.accent,
      onRefresh: widget.onRefresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.t('mobile.studio.coursesHubTitle'),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    l10n.t('mobile.studio.coursesHubHint'),
                    style: const TextStyle(
                      color: AppTheme.muted,
                      fontSize: 13.5,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _StatsRow(
                    all: widget.courses.length,
                    live: _countExact('APPROVED'),
                    draft: _countExact('DRAFT'),
                    review: _reviewCount,
                    selected: _filter,
                    onSelect: (v) => setState(() => _filter = v),
                  ),
                ],
              ),
            ),
          ),
          if (widget.courses.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _EmptyCourses(onCreate: () => _openWizard()),
            )
          else if (filtered.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Text(
                  l10n.t('mobile.studio.noCoursesInFilter'),
                  style: const TextStyle(color: AppTheme.muted),
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              sliver: SliverList.builder(
                itemCount: filtered.length,
                itemBuilder: (context, index) {
                  final course = filtered[index];
                  return TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: 1),
                    duration: Duration(
                      milliseconds: 280 + (index * 40).clamp(0, 240),
                    ),
                    curve: Curves.easeOutCubic,
                    builder: (context, t, child) => Opacity(
                      opacity: t,
                      child: Transform.translate(
                        offset: Offset(0, 12 * (1 - t)),
                        child: child,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: _CourseManageCard(
                        course: course,
                        locale: locale,
                        onManage: () => _openManage(course['id'].toString()),
                        onAddVideo: () => _openUpload(course),
                        onContinueWizard: () =>
                            _openWizard(courseId: course['id']?.toString()),
                        onSubmit: () => _submit(course['id'].toString()),
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    required this.all,
    required this.live,
    required this.draft,
    required this.review,
    required this.selected,
    required this.onSelect,
  });

  final int all;
  final int live;
  final int draft;
  final int review;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final items = [
      ('ALL', l10n.t('mobile.studio.filterAll'), all, AppTheme.accent),
      ('APPROVED', l10n.t('mobile.studio.filterLive'), live, const Color(0xFF34D399)),
      ('DRAFT', l10n.t('mobile.studio.filterDraft'), draft, const Color(0xFFFBBF24)),
      ('REVIEW', l10n.t('mobile.studio.filterReview'), review, const Color(0xFF60A5FA)),
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final item in items) ...[
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: _FilterChip(
                label: item.$2,
                count: item.$3,
                color: item.$4,
                selected: selected == item.$1,
                onTap: () => onSelect(item.$1),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.count,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            color: selected ? color.withValues(alpha: 0.16) : AppTheme.card,
            border: Border.all(
              color: selected ? color : AppTheme.cardBorder,
              width: selected ? 1.4 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: selected ? color : Colors.white70,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: selected
                      ? color.withValues(alpha: 0.25)
                      : Colors.white.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: selected ? color : AppTheme.muted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyCourses extends StatelessWidget {
  const _EmptyCourses({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [
                  AppTheme.primary.withValues(alpha: 0.35),
                  AppTheme.accent.withValues(alpha: 0.2),
                ],
              ),
              border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
            ),
            child: const Icon(Icons.menu_book_rounded, size: 40, color: AppTheme.accent),
          ),
          const SizedBox(height: 20),
          Text(
            l10n.t('mobile.studio.emptyCoursesTitle'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.t('mobile.studio.emptyCoursesHint'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.muted, height: 1.45),
          ),
          const SizedBox(height: 22),
          FilledButton.icon(
            onPressed: onCreate,
            icon: const Icon(Icons.add_rounded),
            label: Text(l10n.t('mobile.teacher.newCourse')),
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _CourseManageCard extends StatelessWidget {
  const _CourseManageCard({
    required this.course,
    required this.locale,
    required this.onManage,
    required this.onAddVideo,
    required this.onContinueWizard,
    required this.onSubmit,
  });

  final Map<String, dynamic> course;
  final String locale;
  final VoidCallback onManage;
  final VoidCallback onAddVideo;
  final VoidCallback onContinueWizard;
  final VoidCallback onSubmit;

  Color _statusColor(String status) {
    return switch (status) {
      'APPROVED' => const Color(0xFF34D399),
      'DRAFT' => const Color(0xFFFBBF24),
      'PENDING_REVIEW' => const Color(0xFF60A5FA),
      'REJECTED' => const Color(0xFFF87171),
      'CLOSED' => AppTheme.muted,
      _ => AppTheme.muted,
    };
  }

  String _statusLabel(dynamic l10n, String status) {
    return switch (status) {
      'APPROVED' => l10n.t('mobile.studio.statusLive'),
      'DRAFT' => l10n.t('mobile.studio.statusDraft'),
      'PENDING_REVIEW' => l10n.t('mobile.studio.statusPending'),
      'REJECTED' => l10n.t('mobile.studio.statusRejected'),
      'CLOSED' => l10n.t('mobile.studio.statusClosed'),
      _ => status,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final status = course['status']?.toString() ?? '';
    final title = course['titleEn']?.toString() ??
        course['title']?.toString() ??
        l10n.t('mobile.teacher.manageCourse');
    final thumb = course['thumbnail']?.toString();
    final price = (course['price'] as num?)?.toDouble() ?? 0;
    final lessons = (course['lessons'] as List?)?.length ?? 0;
    final quizzes = (course['_count'] as Map?)?['quizzes'] as num? ??
        (course['quizzes'] as List?)?.length ??
        0;
    final purchases = (course['_count'] as Map?)?['purchases'] as num? ?? 0;
    final subject = course['subject'] is Map
        ? localizedText(course['subject'] as Map<String, dynamic>, locale, prefix: 'name')
        : '';
    final stage = course['stage'] is Map
        ? localizedText(course['stage'] as Map<String, dynamic>, locale, prefix: 'name')
        : '';
    final meta = [if (subject.isNotEmpty) subject, if (stage.isNotEmpty) stage].join(' · ');
    final statusColor = _statusColor(status);
    final notes = course['reviewNotes']?.toString();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onManage,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            color: AppTheme.card,
            border: Border.all(color: AppTheme.cardBorder),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.22),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (thumb != null && thumb.isNotEmpty)
                        Image.network(
                          thumb,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => _CoverFallback(),
                        )
                      else
                        const _CoverFallback(),
                      Positioned(
                        top: 12,
                        left: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(99),
                            border: Border.all(color: statusColor.withValues(alpha: 0.7)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 7,
                                height: 7,
                                decoration: BoxDecoration(
                                  color: statusColor,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                _statusLabel(l10n, status),
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: statusColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        top: 12,
                        right: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.55),
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            price <= 0
                                ? l10n.t('mobile.teacher.markFree')
                                : '${price.toStringAsFixed(0)} IQD',
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16.5,
                        fontWeight: FontWeight.w800,
                        height: 1.25,
                      ),
                    ),
                    if (meta.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        meta,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                      ),
                    ],
                    if (status == 'REJECTED' && notes != null && notes.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        l10n.t('mobile.teacher.rejectedBanner', {'notes': notes}),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFF87171),
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _MetaPill(
                          icon: Icons.videocam_outlined,
                          label: l10n.t('mobile.studio.lessonsCount', {
                            'count': '$lessons',
                          }),
                        ),
                        const SizedBox(width: 8),
                        _MetaPill(
                          icon: Icons.quiz_outlined,
                          label: l10n.t('mobile.studio.quizzesCount', {
                            'count': '$quizzes',
                          }),
                        ),
                        if (purchases > 0) ...[
                          const SizedBox(width: 8),
                          _MetaPill(
                            icon: Icons.people_outline,
                            label: l10n.t('mobile.studio.studentsCount', {
                              'count': '$purchases',
                            }),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: onManage,
                            icon: const Icon(Icons.tune_rounded, size: 18),
                            label: Text(l10n.t('mobile.studio.openManage')),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton.tonalIcon(
                            onPressed: onAddVideo,
                            icon: const Icon(Icons.upload_rounded, size: 18),
                            label: Text(l10n.t('mobile.studio.addVideo')),
                          ),
                        ),
                        const SizedBox(width: 4),
                        PopupMenuButton<String>(
                          onSelected: (v) {
                            if (v == 'wizard') onContinueWizard();
                            if (v == 'submit') onSubmit();
                            if (v == 'manage') onManage();
                          },
                          itemBuilder: (_) => [
                            if (status == 'DRAFT' || status == 'REJECTED')
                              PopupMenuItem(
                                value: 'wizard',
                                child: Text(l10n.t('mobile.studio.continueDraft')),
                              ),
                            if (status == 'DRAFT' || status == 'REJECTED')
                              PopupMenuItem(
                                value: 'submit',
                                child: Text(l10n.t('mobile.teacher.submitForReview')),
                              ),
                            PopupMenuItem(
                              value: 'manage',
                              child: Text(l10n.t('mobile.studio.openManage')),
                            ),
                          ],
                        ),
                      ],
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

class _CoverFallback extends StatelessWidget {
  const _CoverFallback();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.45),
            AppTheme.accent.withValues(alpha: 0.2),
            AppTheme.card,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Icon(Icons.school_rounded, size: 42, color: Colors.white54),
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.accent),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
