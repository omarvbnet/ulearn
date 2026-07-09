import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/features/video/video_player_screen.dart';

/// Profile screen listing fully completed courses with watch time and quiz scores.
class CompletedCoursesScreen extends StatefulWidget {
  const CompletedCoursesScreen({super.key});

  @override
  State<CompletedCoursesScreen> createState() => _CompletedCoursesScreenState();
}

class _CompletedCoursesScreenState extends State<CompletedCoursesScreen> {
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>>? _courses;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data =
          await context.read<ApiClient>().get('/api/profile/completed-courses');
      if (!mounted) return;
      setState(() {
        _summary = (data['summary'] as Map<String, dynamic>?) ?? {};
        _courses =
            ((data['courses'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _summary = {};
        _courses = [];
      });
    }
  }

  void _openCourse(Map<String, dynamic> course) {
    final type = course['type']?.toString() ?? 'store';
    if (type == 'store') {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CourseDetailScreen(courseId: course['id'].toString()),
        ),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoPlayerScreen(
          lessonId: (course['resumeLessonId'] ?? course['id']).toString(),
          title: localizedText(course, context.localeCode),
        ),
      ),
    );
  }

  String _formatDate(String? raw) {
    if (raw == null || raw.isEmpty) return '—';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return '—';
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;
    final courses = _courses;
    final summary = _summary;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileCompletedCourses)),
      body: courses == null
          ? Skeleton(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: const [
                  SkeletonBox(height: 110, radius: 16),
                  SizedBox(height: 16),
                  SkeletonBox(height: 140, radius: 16),
                  SizedBox(height: 12),
                  SkeletonBox(height: 140, radius: 16),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: courses.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(height: MediaQuery.of(context).size.height * 0.2),
                        Icon(
                          Icons.school_outlined,
                          size: 56,
                          color: AppTheme.muted.withValues(alpha: 0.4),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          l10n.profileNoCompletedCourses,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: AppTheme.muted, height: 1.5),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                      itemCount: courses.length + 1,
                      itemBuilder: (context, i) {
                        if (i == 0) {
                          final totalCourses =
                              (summary?['totalCourses'] as num?)?.toInt() ?? courses.length;
                          final totalSec =
                              (summary?['totalCompletionTimeSec'] as num?)?.toInt() ?? 0;
                          final quizzesTaken =
                              (summary?['quizzesTaken'] as num?)?.toInt() ?? 0;
                          final quizzesPassed =
                              (summary?['quizzesPassed'] as num?)?.toInt() ?? 0;

                          return StaggeredItem(
                            index: 0,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 16),
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: [
                                    AppTheme.primary.withValues(alpha: 0.2),
                                    AppTheme.card,
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppTheme.cardBorder),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    l10n.profileCompletedSummary,
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      _SummaryChip(
                                        icon: Icons.check_circle_outline,
                                        label: l10n.profileCompletedCount(totalCourses),
                                      ),
                                      _SummaryChip(
                                        icon: Icons.schedule_outlined,
                                        label: l10n.profileTotalWatchTime(
                                          formatDuration(totalSec),
                                        ),
                                      ),
                                      _SummaryChip(
                                        icon: Icons.quiz_outlined,
                                        label: l10n.profileQuizResults(
                                          quizzesPassed,
                                          quizzesTaken,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        }

                        final course = courses[i - 1];
                        final title = localizedText(course, locale);
                        final thumb = course['thumbnail']?.toString();
                        final totalSec =
                            (course['totalDurationSec'] as num?)?.toInt() ?? 0;
                        final lessonCount = (course['lessonCount'] as num?)?.toInt() ?? 0;
                        final completedAt = course['completedAt']?.toString();
                        final teacherName = course['teacherName']?.toString();
                        final quizzes = ((course['quizzes'] as List<dynamic>?) ?? [])
                            .cast<Map<String, dynamic>>();

                        return StaggeredItem(
                          index: i,
                          child: InkWell(
                            onTap: () => _openCourse(course),
                            borderRadius: BorderRadius.circular(16),
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              decoration: BoxDecoration(
                                color: AppTheme.card,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppTheme.cardBorder),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  ClipRRect(
                                    borderRadius: const BorderRadius.vertical(
                                      top: Radius.circular(16),
                                    ),
                                    child: SizedBox(
                                      height: 110,
                                      child: thumb != null && thumb.isNotEmpty
                                          ? CachedImage(
                                              url: thumb,
                                              fit: BoxFit.cover,
                                              width: double.infinity,
                                              height: 110,
                                            )
                                          : Container(
                                              color: AppTheme.primary.withValues(alpha: 0.15),
                                              alignment: Alignment.center,
                                              child: Icon(
                                                Icons.play_lesson_outlined,
                                                size: 40,
                                                color: AppTheme.accent.withValues(alpha: 0.6),
                                              ),
                                            ),
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
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                  fontSize: 16,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 8,
                                                vertical: 4,
                                              ),
                                              decoration: BoxDecoration(
                                                color: Colors.greenAccent.withValues(alpha: 0.12),
                                                borderRadius: BorderRadius.circular(8),
                                                border: Border.all(
                                                  color: Colors.greenAccent.withValues(alpha: 0.35),
                                                ),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Icon(
                                                    Icons.check_circle_rounded,
                                                    size: 14,
                                                    color: Colors.greenAccent.withValues(alpha: 0.95),
                                                  ),
                                                  const SizedBox(width: 4),
                                                  Text(
                                                    l10n.t('quiz.passed'),
                                                    style: TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: FontWeight.w700,
                                                      color: Colors.greenAccent.withValues(alpha: 0.95),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          [
                                            if (teacherName != null && teacherName.isNotEmpty)
                                              teacherName,
                                            l10n.homeLessons(lessonCount),
                                            formatDuration(totalSec),
                                            l10n.profileCompletedOn(_formatDate(completedAt)),
                                          ].join(' · '),
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppTheme.muted,
                                            height: 1.35,
                                          ),
                                        ),
                                        if (quizzes.isNotEmpty) ...[
                                          const SizedBox(height: 12),
                                          Text(
                                            l10n.t('student.quizzes'),
                                            style: const TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                              color: AppTheme.foreground,
                                            ),
                                          ),
                                          const SizedBox(height: 6),
                                          ...quizzes.map((q) {
                                            final qTitle = localizedText(q, locale);
                                            final attempts = (q['attempts'] as num?)?.toInt() ?? 0;
                                            final best =
                                                (q['bestPercentage'] as num?)?.toDouble();
                                            final passed = q['passed'] == true;
                                            final timeSpent =
                                                (q['timeSpentSec'] as num?)?.toInt();
                                            final passPct =
                                                (q['passPercentage'] as num?)?.toInt() ?? 50;

                                            if (attempts == 0) {
                                              return Padding(
                                                padding: const EdgeInsets.only(bottom: 6),
                                                child: Row(
                                                  children: [
                                                    const Icon(
                                                      Icons.quiz_outlined,
                                                      size: 16,
                                                      color: AppTheme.muted,
                                                    ),
                                                    const SizedBox(width: 8),
                                                    Expanded(
                                                      child: Text(
                                                        '$qTitle · ${l10n.profileQuizNotTaken}',
                                                        style: const TextStyle(
                                                          fontSize: 12,
                                                          color: AppTheme.muted,
                                                        ),
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              );
                                            }

                                            return Padding(
                                              padding: const EdgeInsets.only(bottom: 6),
                                              child: Row(
                                                children: [
                                                  Icon(
                                                    passed
                                                        ? Icons.check_circle_rounded
                                                        : Icons.cancel_outlined,
                                                    size: 16,
                                                    color: passed
                                                        ? Colors.greenAccent
                                                        : Colors.orangeAccent,
                                                  ),
                                                  const SizedBox(width: 8),
                                                  Expanded(
                                                    child: Text(
                                                      [
                                                        qTitle,
                                                        '${best?.round() ?? 0}% (${l10n.t('quiz.passMark')} $passPct%)',
                                                        if (timeSpent != null && timeSpent > 0)
                                                          formatDuration(timeSpent),
                                                      ].join(' · '),
                                                      style: const TextStyle(fontSize: 12),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            );
                                          }),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}

class _SummaryChip extends StatelessWidget {
  const _SummaryChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.background.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.accent),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
