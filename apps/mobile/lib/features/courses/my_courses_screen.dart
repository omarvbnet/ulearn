import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/network/network_status.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/features/store/teacher_studio_screen.dart';
import 'package:ulearn/features/video/video_player_screen.dart';
import 'package:ulearn/features/whiteboard/domain/offline_store.dart';

/// Subscribed and purchased courses with completion progress and search filters.
class MyCoursesScreen extends StatefulWidget {
  const MyCoursesScreen({super.key});

  @override
  State<MyCoursesScreen> createState() => _MyCoursesScreenState();
}

class _MyCoursesScreenState extends State<MyCoursesScreen> {
  List<Map<String, dynamic>> _courses = [];
  bool _loading = true;
  String _search = '';
  String _sort = 'recent';
  int _minProgress = 0;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) {
      if (mounted) setState(() { _courses = []; _loading = false; });
      return;
    }
    setState(() => _loading = true);
    final api = context.read<ApiClient>();
    try {
      if (!await NetworkStatus.isOnline()) {
        final offline = await WhiteboardOfflineStore.libraryCourseCards();
        if (!mounted) return;
        setState(() {
          _courses = offline;
          _loading = false;
        });
        return;
      }
      final q = _search.trim();
      final params = <String, String>{
        'sort': _sort,
        if (q.isNotEmpty) 'q': q,
        if (_minProgress > 0) 'minProgress': '$_minProgress',
      };
      final query = params.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&');
      final data = await api.get('/api/my-courses?$query');
      if (!mounted) return;
      final online =
          ((data['courses'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      // Merge any offline-only board courses not already in the API list.
      final offline = await WhiteboardOfflineStore.libraryCourseCards();
      final onlineIds = online.map((c) => c['id']?.toString()).whereType<String>().toSet();
      final merged = [
        ...online,
        ...offline.where((c) => !onlineIds.contains(c['id']?.toString())),
      ];
      setState(() {
        _courses = merged;
        _loading = false;
      });
    } catch (_) {
      final offline = await WhiteboardOfflineStore.libraryCourseCards();
      if (!mounted) return;
      setState(() {
        _courses = offline;
        _loading = false;
      });
    }
  }

  void _onSearch(String v) {
    _search = v;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  void _openCourse(Map<String, dynamic> c) {
    final type = c['type']?.toString() ?? 'store';
    if (type == 'store') {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CourseDetailScreen(courseId: c['id'].toString()),
        ),
      );
      return;
    }
    final resumeId = c['resumeLessonId']?.toString();
    if (resumeId != null) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => VideoPlayerScreen(
            lessonId: resumeId,
            title: localizedText(c, context.localeCode),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isTeacher = auth.user?.role == 'TEACHER';
    final locale = context.localeCode;
    final l10n = context.l10n;

    if (!auth.isAuthenticated) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.lock_outline_rounded, size: 48, color: AppTheme.muted.withValues(alpha: 0.5)),
              const SizedBox(height: 14),
              Text(
                l10n.t('mobile.auth.guestCoursesHint'),
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.muted, height: 1.4),
              ),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: () async {
                  if (await requireAuth(context) && mounted) _load();
                },
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.black,
                ),
                child: Text(l10n.navLogin),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            children: [
              TextField(
                onChanged: _onSearch,
                decoration: InputDecoration(
                  hintText: '${l10n.t('common.search')}…',
                  prefixIcon: Icon(Icons.search, color: AppTheme.muted),
                  suffixIcon: isTeacher
                      ? IconButton(
                          tooltip: l10n.profileTeacherStudio,
                          icon: const Icon(Icons.video_call_outlined, color: AppTheme.accent),
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const TeacherStudioScreen()),
                          ),
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _FilterChip(
                      label: l10n.t('student.resumedFrom'),
                      selected: _sort == 'recent',
                      onTap: () {
                        setState(() => _sort = 'recent');
                        _load();
                      },
                    ),
                    _FilterChip(
                      label: l10n.t('dashboard.completionRate'),
                      selected: _sort == 'progress',
                      onTap: () {
                        setState(() => _sort = 'progress');
                        _load();
                      },
                    ),
                    _FilterChip(
                      label: 'A–Z',
                      selected: _sort == 'title',
                      onTap: () {
                        setState(() => _sort = 'title');
                        _load();
                      },
                    ),
                    const SizedBox(width: 8),
                    _FilterChip(
                      label: l10n.continueWatching,
                      selected: _minProgress == 1,
                      onTap: () {
                        setState(() => _minProgress = _minProgress == 1 ? 0 : 1);
                        _load();
                      },
                    ),
                    _FilterChip(
                      label: '50%+',
                      selected: _minProgress == 50,
                      onTap: () {
                        setState(() => _minProgress = _minProgress == 50 ? 0 : 50);
                        _load();
                      },
                    ),
                  ],
                ),
              ),
              if (isTeacher)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      l10n.profileTeacherStudioHint,
                      style: TextStyle(fontSize: 12, color: AppTheme.muted.withValues(alpha: 0.9)),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? SkeletonList(
                  count: 4,
                  itemBuilder: (_) => const SkeletonCourseCard(),
                )
              : _courses.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.school_outlined, size: 48, color: AppTheme.muted.withValues(alpha: 0.5)),
                          const SizedBox(height: 12),
                          Text(
                            isTeacher
                                ? '${l10n.t('student.noCertificates')}\n${l10n.t('student.noCertificatesHint')}'
                                : '${l10n.t('student.noCourses')}\n${l10n.homeBrowseStore}',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.muted),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _courses.length,
                        itemBuilder: (context, i) {
                          final c = _courses[i];
                          final title = localizedText(c, locale);
                          final progress = (c['progressPct'] as num?)?.toInt() ?? 0;
                          final thumb = c['thumbnail']?.toString();
                          final type = c['type']?.toString() ?? 'store';
                          final teacherName = c['teacherName']?.toString();
                          final lessonCount = (c['lessonCount'] as num?)?.toInt() ?? 0;

                          return StaggeredItem(
                            index: i,
                            child: InkWell(
                              onTap: () => _openCourse(c),
                              borderRadius: BorderRadius.circular(16),
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 14),
                                decoration: BoxDecoration(
                                  color: AppTheme.card,
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(color: AppTheme.cardBorder),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Stack(
                                      children: [
                                        ClipRRect(
                                          borderRadius: const BorderRadius.vertical(
                                            top: Radius.circular(16),
                                          ),
                                          child: SizedBox(
                                            height: 130,
                                            width: double.infinity,
                                            child: thumb != null && thumb.isNotEmpty
                                                ? CachedImage(
                                                    url: thumb,
                                                    fit: BoxFit.cover,
                                                    error: _CoverFallback(title: title),
                                                  )
                                                : _CoverFallback(title: title),
                                          ),
                                        ),
                                        Positioned(
                                          right: 12,
                                          bottom: 12,
                                          child: _ProgressBadge(pct: progress),
                                        ),
                                          if (type == 'curriculum')
                                          Positioned(
                                            left: 12,
                                            top: 12,
                                            child: Container(
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: Colors.black54,
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: Text(
                                                l10n.authCertificate,
                                                style: TextStyle(
                                                  color: AppTheme.accent,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                          ),
                                        if (c['offlineOnly'] == true)
                                          Positioned(
                                            left: 12,
                                            top: 12,
                                            child: Container(
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: Colors.black54,
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: const Text(
                                                'Offline',
                                                style: TextStyle(
                                                  color: AppTheme.accent,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.all(14),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            title,
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            [
                                              if (teacherName != null) teacherName,
                                              l10n.t('student.videos'),
                                              '$lessonCount',
                                              '$progress%',
                                            ].join(' · '),
                                            style: TextStyle(
                                              fontSize: 12.5,
                                              color: AppTheme.muted,
                                            ),
                                          ),
                                          const SizedBox(height: 10),
                                          ClipRRect(
                                            borderRadius: BorderRadius.circular(4),
                                            child: LinearProgressIndicator(
                                              value: progress / 100,
                                              minHeight: 5,
                                              backgroundColor: AppTheme.cardBorder,
                                              color: AppTheme.accent,
                                            ),
                                          ),
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
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: AppTheme.primary.withValues(alpha: 0.25),
        checkmarkColor: AppTheme.accent,
        labelStyle: TextStyle(
          color: selected ? AppTheme.foreground : AppTheme.muted,
          fontSize: 13,
        ),
      ),
    );
  }
}

class _ProgressBadge extends StatelessWidget {
  const _ProgressBadge({required this.pct});

  final int pct;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
      ),
      child: Text(
        '$pct%',
        style: const TextStyle(
          color: AppTheme.accent,
          fontWeight: FontWeight.bold,
          fontSize: 13,
        ),
      ),
    );
  }
}

class _CoverFallback extends StatelessWidget {
  const _CoverFallback({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(gradient: AppTheme.gradient),
      alignment: Alignment.center,
      child: Text(
        title.isNotEmpty ? title[0].toUpperCase() : '?',
        style: const TextStyle(
          fontSize: 48,
          fontWeight: FontWeight.w900,
          color: Colors.white24,
        ),
      ),
    );
  }
}
