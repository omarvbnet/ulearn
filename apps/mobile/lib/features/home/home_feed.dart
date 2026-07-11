import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

/// Locale-aware course/ad title.
String localizedText(Map<String, dynamic> item, String locale, {String prefix = 'title'}) {
  final key = switch (locale) {
    'AR' => '${prefix}Ar',
    'KU' => '${prefix}Ku',
    'TR' => '${prefix}Tr',
    _ => '${prefix}En',
  };
  final localized = item[key]?.toString();
  if (localized != null && localized.isNotEmpty) return localized;
  return item['${prefix}En']?.toString() ?? '';
}

String formatDuration(int totalSec) {
  if (totalSec <= 0) return '—';
  final h = totalSec ~/ 3600;
  final m = (totalSec % 3600) ~/ 60;
  if (h > 0) return m > 0 ? '${h}h ${m}m' : '${h}h';
  if (m > 0) return '${m}m';
  return '${totalSec}s';
}

String formatCount(int n) {
  if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
  if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
  return '$n';
}

/// The main home tab: welcome header, advertisements carousel and
/// the store courses for the student's educational stage.
class HomeFeed extends StatefulWidget {
  const HomeFeed({super.key});

  @override
  State<HomeFeed> createState() => HomeFeedState();
}

class HomeFeedState extends State<HomeFeed> {
  Map<String, dynamic>? _stage;
  List<Map<String, dynamic>> _stages = [];
  List<Map<String, dynamic>> _ads = [];
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _continueWatching = [];
  bool _loading = true;
  bool _searching = false;
  String? _error;

  // Filters: null stage = my own stage, 'all' = every stage.
  String? _stageFilter;
  String? _levelFilter;
  final _search = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onQueryChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) _load(soft: true);
    });
  }

  Future<void> _load({bool soft = false}) async {
    if (soft) setState(() => _searching = true);
    try {
      final params = <String, String>{
        'stageId': ?_stageFilter,
        'level': ?_levelFilter,
        if (_search.text.trim().isNotEmpty) 'q': _search.text.trim(),
      };
      final query = params.isEmpty
          ? ''
          : '?${params.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&')}';
      final api = context.read<ApiClient>();
      final data = await api.get('/api/home$query');
      Map<String, dynamic> myCourses = {};
      try {
        myCourses = await api.get('/api/my-courses?sort=recent&minProgress=1');
      } catch (_) {}
      final continueItems = ((myCourses['courses'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>()
          .where((c) {
            final pct = (c['progressPct'] as num?)?.toDouble() ?? 0;
            final type = c['type']?.toString() ?? 'store';
            return type == 'store' && pct > 0 && pct < 100;
          })
          .take(12)
          .map((c) => Map<String, dynamic>.from(c))
          .toList();

      final homeCourses =
          ((data['courses'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      final homeById = {
        for (final c in homeCourses) c['id']?.toString() ?? '': c,
      };
      for (final c in continueItems) {
        final home = homeById[c['id']?.toString() ?? ''];
        if (home == null) continue;
        final thumb = c['thumbnail']?.toString();
        final homeThumb = home['thumbnail']?.toString();
        if ((thumb == null || thumb.isEmpty) && homeThumb != null && homeThumb.isNotEmpty) {
          c['thumbnail'] = homeThumb;
        } else if (homeThumb != null && homeThumb.isNotEmpty) {
          // Prefer the live home cover so teacher updates show immediately.
          c['thumbnail'] = homeThumb;
        }
        c['updatedAt'] = home['updatedAt'] ?? c['updatedAt'];
      }

      if (!mounted) return;
      setState(() {
        _stage = data['stage'] as Map<String, dynamic>?;
        _stages = ((data['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _ads = ((data['ads'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _courses = homeCourses;
        _continueWatching = continueItems;
        _loading = false;
        _searching = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _searching = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _searching = false;
        _error = context.l10n.t('mobile.error.generic');
      });
    }
  }

  bool get _hasActiveFilters =>
      _stageFilter != null || _levelFilter != null || _search.text.trim().isNotEmpty;

  String _stageLabel(BuildContext context, String locale) {
    final l10n = context.l10n;
    if (_stageFilter == null) return l10n.homeMyStage;
    if (_stageFilter == 'all') return l10n.homeAllStages;
    final match = _stages.where((s) => s['id'] == _stageFilter);
    return match.isEmpty ? l10n.homeStage : localizedText(match.first, locale, prefix: 'name');
  }

  Future<void> _reactToCourse(Map<String, dynamic> course, String type) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final id = course['id'].toString();
    final previous = {
      'likes': course['likes'],
      'dislikes': course['dislikes'],
      'myReaction': course['myReaction'],
    };

    // Optimistic update for instant feedback.
    setState(() {
      final mine = course['myReaction']?.toString();
      if (mine == type) {
        course['myReaction'] = null;
        course[type == 'LIKE' ? 'likes' : 'dislikes'] =
            (course[type == 'LIKE' ? 'likes' : 'dislikes'] as int) - 1;
      } else {
        if (mine != null) {
          course[mine == 'LIKE' ? 'likes' : 'dislikes'] =
              (course[mine == 'LIKE' ? 'likes' : 'dislikes'] as int) - 1;
        }
        course['myReaction'] = type;
        course[type == 'LIKE' ? 'likes' : 'dislikes'] =
            (course[type == 'LIKE' ? 'likes' : 'dislikes'] as int) + 1;
      }
    });

    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/$id/react', {'type': type});
      if (!mounted) return;
      setState(() {
        course['likes'] = data['likes'];
        course['dislikes'] = data['dislikes'];
        course['myReaction'] = data['myReaction'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => course.addAll(previous));
    }
  }

  Future<void> _toggleFavorite(Map<String, dynamic> course) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final id = course['id'].toString();
    final previous = {
      'favorites': course['favorites'],
      'favoritedByMe': course['favoritedByMe'],
    };

    setState(() {
      final fav = course['favoritedByMe'] == true;
      course['favoritedByMe'] = !fav;
      course['favorites'] = ((course['favorites'] as num?)?.toInt() ?? 0) + (fav ? -1 : 1);
    });

    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/$id/favorite', {});
      if (!mounted) return;
      setState(() {
        course['favorites'] = data['favorites'];
        course['favoritedByMe'] = data['favoritedByMe'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => course.addAll(previous));
    }
  }

  Future<void> _pickStage() async {
    final locale = context.localeCode;
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final l10n = ctx.l10n;
        return SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 12),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                l10n.t('mobile.profile.changeStage'),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.school_outlined, color: AppTheme.accent),
              title: Text(l10n.homeMyStage),
              trailing: _stageFilter == null
                  ? const Icon(Icons.check, color: AppTheme.accent)
                  : null,
              onTap: () => Navigator.pop(ctx, 'mine'),
            ),
            ListTile(
              leading: const Icon(Icons.public, color: AppTheme.accent),
              title: Text(l10n.homeAllStages),
              trailing: _stageFilter == 'all'
                  ? const Icon(Icons.check, color: AppTheme.accent)
                  : null,
              onTap: () => Navigator.pop(ctx, 'all'),
            ),
            Divider(color: AppTheme.cardBorder),
            ..._stages.map((s) {
              final id = s['id'].toString();
              return ListTile(
                leading: Icon(Icons.layers_outlined, color: AppTheme.muted),
                title: Text(localizedText(s, locale, prefix: 'name')),
                trailing: _stageFilter == id
                    ? const Icon(Icons.check, color: AppTheme.accent)
                    : null,
                onTap: () => Navigator.pop(ctx, id),
              );
            }),
          ],
        ),
      );
      },
    );

    if (picked == null || !mounted) return;
    setState(() => _stageFilter = picked == 'mine' ? null : picked);
    _load(soft: true);
  }

  Future<void> _likeAd(Map<String, dynamic> ad) async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final id = ad['id'].toString();
    final previous = {'likes': ad['likes'], 'likedByMe': ad['likedByMe']};

    setState(() {
      final liked = ad['likedByMe'] == true;
      ad['likedByMe'] = !liked;
      ad['likes'] = (ad['likes'] as int) + (liked ? -1 : 1);
    });

    try {
      final data = await context.read<ApiClient>().post('/api/ads/$id/like', {});
      if (!mounted) return;
      setState(() {
        ad['likes'] = data['likes'];
        ad['likedByMe'] = data['likedByMe'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => ad.addAll(previous));
    }
  }

  Future<void> _openCourse(Map<String, dynamic> course) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CourseDetailScreen(
          courseId: course['id'].toString(),
          summary: course,
        ),
      ),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final locale = context.localeCode;
    final l10n = context.l10n;

    if (_loading) return const _HomeSkeleton();

    return RefreshIndicator(
      color: AppTheme.accent,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          StaggeredItem(
            index: 0,
            child: _WelcomeHeader(
              name: user?.fullLegalName,
              stageName: _stage != null
                  ? localizedText(_stage!, locale, prefix: 'name')
                  : null,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!, style: TextStyle(color: AppTheme.muted)),
                ),
              ),
            ),
          StaggeredItem(
            index: 1,
            child: _FiltersBar(
              controller: _search,
              onQueryChanged: _onQueryChanged,
              onClearQuery: () {
                _search.clear();
                _load(soft: true);
              },
              stageLabel: _stageLabel(context, locale),
              stageActive: _stageFilter != null,
              onPickStage: _pickStage,
              levelFilter: _levelFilter,
              onLevelChanged: (level) {
                setState(() => _levelFilter = level);
                _load(soft: true);
              },
            ),
          ),
          if (_ads.isNotEmpty && !_hasActiveFilters) ...[
            const SizedBox(height: 8),
            StaggeredItem(
              index: 2,
              child: _AdsSection(
                ads: _ads,
                locale: locale,
                onLike: _likeAd,
              ),
            ),
          ],
          if (_continueWatching.isNotEmpty && !_hasActiveFilters) ...[
            const SizedBox(height: 8),
            StaggeredItem(
              index: 3,
              child: _ContinueWatchingRail(
                courses: _continueWatching,
                locale: locale,
                onOpen: _openCourse,
              ),
            ),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
            child: Row(
              children: [
                Container(
                  width: 4,
                  height: 18,
                  decoration: BoxDecoration(
                    gradient: AppTheme.gradient,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _search.text.trim().isNotEmpty
                      ? l10n.t('common.search')
                      : _stageFilter == 'all'
                          ? l10n.homeAllStages
                          : _stageFilter != null
                              ? _stageLabel(context, locale)
                              : _stage != null
                                  ? l10n.t('student.noCoursesHint')
                                  : l10n.t('student.noCourses'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                ),
                const Spacer(),
                if (_searching)
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.accent,
                    ),
                  )
                else
                  Text(
                    '${_courses.length}',
                    style: TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
              ],
            ),
          ),
          if (_courses.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    children: [
                      Icon(
                        _hasActiveFilters
                            ? Icons.search_off_rounded
                            : Icons.auto_stories_outlined,
                        size: 42,
                        color: AppTheme.muted,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _hasActiveFilters
                            ? l10n.homeNoCoursesInStage
                            : '${l10n.homeNoCoursesInStage}\n${l10n.t('student.noCoursesHint')}',
                        style: TextStyle(color: AppTheme.muted),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ..._courses.asMap().entries.map(
                (e) => StaggeredItem(
                  index: e.key + 4,
                  child: CourseCard(
                    course: e.value,
                    locale: locale,
                    onTap: () => _openCourse(e.value),
                    onReact: (type) => _reactToCourse(e.value, type),
                    onFavorite: () => _toggleFavorite(e.value),
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

// ── Welcome header ─────────────────────────────────────────────

class _WelcomeHeader extends StatelessWidget {
  const _WelcomeHeader({this.name, this.stageName});

  final String? name;
  final String? stageName;

  @override
  Widget build(BuildContext context) {
    final firstName =
        (name ?? context.l10n.t('mobile.roles.student')).trim().split(RegExp(r'\s+')).first;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          colors: [
            AppTheme.primary.withValues(alpha: 0.22),
            AppTheme.accent.withValues(alpha: 0.10),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${context.l10n.studentWelcome},',
                  style: TextStyle(color: AppTheme.foreground.withValues(alpha: 0.75)),
                ),
                const SizedBox(height: 2),
                Text(
                  firstName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                if (stageName != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.school_outlined, size: 14, color: AppTheme.accent),
                        const SizedBox(width: 5),
                        Flexible(
                          child: Text(
                            stageName!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppTheme.accent,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          ScaleIn(
            delayMs: 150,
            child: Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppTheme.gradient,
              ),
              child: const Icon(Icons.rocket_launch_outlined, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Search & filters ───────────────────────────────────────────

class _FiltersBar extends StatelessWidget {
  const _FiltersBar({
    required this.controller,
    required this.onQueryChanged,
    required this.onClearQuery,
    required this.stageLabel,
    required this.stageActive,
    required this.onPickStage,
    required this.levelFilter,
    required this.onLevelChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String> onQueryChanged;
  final VoidCallback onClearQuery;
  final String stageLabel;
  final bool stageActive;
  final VoidCallback onPickStage;
  final String? levelFilter;
  final ValueChanged<String?> onLevelChanged;

  static List<(String?, String, IconData)> _levels(BuildContext context) {
    final l10n = context.l10n;
    return [
      (null, l10n.t('mobile.home.allTeacherLevels'), Icons.all_inclusive),
      ('MASTER', '${l10n.t('mobile.home.teacherLevelMaster')} ★★★', Icons.workspace_premium_outlined),
      ('EXCELLENT', '${l10n.t('mobile.home.teacherLevelExcellent')} ★★', Icons.military_tech_outlined),
      ('GOOD', '${l10n.t('mobile.home.teacherLevelGood')} ★', Icons.thumb_up_alt_outlined),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            builder: (context, value, _) => TextField(
              controller: controller,
              onChanged: onQueryChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '${l10n.t('common.search')}…',
                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                prefixIcon: Icon(Icons.search, color: AppTheme.muted),
                suffixIcon: value.text.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.close, size: 18, color: AppTheme.muted),
                        onPressed: onClearQuery,
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.hardEdge,
            child: Row(
              children: [
                _FilterChip(
                  icon: Icons.school_outlined,
                  label: stageLabel,
                  active: stageActive,
                  trailing: Icons.expand_more,
                  onTap: onPickStage,
                ),
                const SizedBox(width: 8),
                ..._levels(context).map((entry) {
                  final (value, label, icon) = entry;
                  final active = levelFilter == value;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _FilterChip(
                      icon: icon,
                      label: label,
                      active: active,
                      onTap: () => onLevelChanged(active && value != null ? null : value),
                    ),
                  );
                }),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final bool active;
  final IconData? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: active ? AppTheme.primary.withValues(alpha: 0.25) : AppTheme.card,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: active ? AppTheme.accent : AppTheme.cardBorder,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: active ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                color: active ? AppTheme.accent : AppTheme.foreground,
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 2),
              Icon(trailing, size: 16, color: active ? AppTheme.accent : AppTheme.muted),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Ads section ────────────────────────────────────────────────

class _AdsSection extends StatelessWidget {
  const _AdsSection({
    required this.ads,
    required this.locale,
    required this.onLike,
  });

  final List<Map<String, dynamic>> ads;
  final String locale;
  final ValueChanged<Map<String, dynamic>> onLike;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
          child: Row(
            children: [
              Icon(Icons.campaign_outlined, size: 16, color: AppTheme.muted.withValues(alpha: 0.9)),
              const SizedBox(width: 6),
              Text(
                l10n.t('nav.ads'),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.muted,
                  letterSpacing: 0.2,
                ),
              ),
            ],
          ),
        ),
        ClipRect(
          child: _AdsCarousel(ads: ads, locale: locale, onLike: onLike),
        ),
      ],
    );
  }
}

// ── Ads carousel ───────────────────────────────────────────────

class _AdsCarousel extends StatefulWidget {
  const _AdsCarousel({required this.ads, required this.locale, required this.onLike});

  final List<Map<String, dynamic>> ads;
  final String locale;
  final ValueChanged<Map<String, dynamic>> onLike;

  @override
  State<_AdsCarousel> createState() => _AdsCarouselState();
}

class _AdsCarouselState extends State<_AdsCarousel> {
  late final PageController _controller;
  Timer? _timer;
  int _page = 0;

  @override
  void initState() {
    super.initState();
    _controller = PageController(viewportFraction: 1);
    _startAutoPlay();
  }

  void _startAutoPlay() {
    _timer?.cancel();
    if (widget.ads.length < 2) return;
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || !_controller.hasClients) return;
      final next = (_page + 1) % widget.ads.length;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 550),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 152,
          child: PageView.builder(
            controller: _controller,
            clipBehavior: Clip.hardEdge,
            itemCount: widget.ads.length,
            onPageChanged: (i) => setState(() => _page = i),
            itemBuilder: (context, i) {
              final ad = widget.ads[i];
              final title = localizedText(ad, widget.locale);
              final imageUrl = ad['imageUrl']?.toString() ?? '';
              return Padding(
                padding: EdgeInsets.only(
                  left: i == 0 ? 16 : 6,
                  right: i == widget.ads.length - 1 ? 16 : 6,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(18),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (imageUrl.isNotEmpty)
                        Positioned.fill(
                          child: CachedImage(
                            url: imageUrl,
                            fit: BoxFit.cover,
                            cacheVersion: ad['updatedAt']?.toString(),
                            error: const _CoverFallback(),
                          ),
                        )
                      else
                        const Positioned.fill(child: _CoverFallback()),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              Colors.transparent,
                              Colors.black.withValues(alpha: 0.65),
                            ],
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                          ),
                        ),
                      ),
                      Positioned(
                        left: 14,
                        right: 14,
                        bottom: 12,
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                            _AdLikeButton(
                              liked: ad['likedByMe'] == true,
                              count: (ad['likes'] as num?)?.toInt() ?? 0,
                              onTap: () => widget.onLike(ad),
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
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(widget.ads.length, (i) {
            final active = i == _page;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: active ? 20 : 7,
              height: 7,
              decoration: BoxDecoration(
                color: active ? AppTheme.accent : AppTheme.cardBorder,
                borderRadius: BorderRadius.circular(4),
              ),
            );
          }),
        ),
      ],
    );
  }
}

class _AdLikeButton extends StatelessWidget {
  const _AdLikeButton({required this.liked, required this.count, required this.onTap});

  final bool liked;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            color: Colors.white.withValues(alpha: 0.15),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedScale(
                  scale: liked ? 1.15 : 1,
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.elasticOut,
                  child: Icon(
                    liked ? Icons.favorite : Icons.favorite_border,
                    size: 16,
                    color: liked ? Colors.redAccent : Colors.white,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  formatCount(count),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Continue watching ──────────────────────────────────────────

class _ContinueWatchingRail extends StatelessWidget {
  const _ContinueWatchingRail({
    required this.courses,
    required this.locale,
    required this.onOpen,
  });

  final List<Map<String, dynamic>> courses;
  final String locale;
  final ValueChanged<Map<String, dynamic>> onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 10),
          child: Row(
            children: [
              Container(
                width: 4,
                height: 18,
                decoration: BoxDecoration(
                  gradient: AppTheme.gradient,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                l10n.t('mobile.home.continueWatching'),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 168,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: courses.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (context, i) {
              final c = courses[i];
              final title = localizedText(c, locale);
              final thumb = c['thumbnail']?.toString();
              final progress = ((c['progressPct'] as num?)?.toDouble() ?? 0).clamp(0, 100) / 100;
              return InkWell(
                onTap: () => onOpen(c),
                borderRadius: BorderRadius.circular(16),
                child: SizedBox(
                  width: 220,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (thumb != null && thumb.isNotEmpty)
                                Positioned.fill(
                                  child: CachedImage(
                                    url: thumb,
                                    fit: BoxFit.cover,
                                    cacheVersion: c['updatedAt']?.toString(),
                                  ),
                                )
                              else
                                const Positioned.fill(child: _CoverFallback()),
                              DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topCenter,
                                    end: Alignment.bottomCenter,
                                    colors: [
                                      Colors.transparent,
                                      Colors.black.withValues(alpha: 0.72),
                                    ],
                                  ),
                                ),
                              ),
                              Positioned(
                                left: 10,
                                right: 10,
                                bottom: 10,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      title,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 13,
                                        height: 1.25,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(99),
                                      child: LinearProgressIndicator(
                                        value: progress,
                                        minHeight: 4,
                                        backgroundColor: Colors.white24,
                                        valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Positioned(
                                top: 8,
                                left: 8,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.55),
                                    borderRadius: BorderRadius.circular(99),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.play_arrow_rounded, size: 14, color: Colors.white),
                                      const SizedBox(width: 2),
                                      Text(
                                        '${(progress * 100).round()}%',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 11,
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
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.t('mobile.home.resumeCourse'),
                        style: TextStyle(fontSize: 12, color: AppTheme.muted),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _TeacherAvatar extends StatelessWidget {
  const _TeacherAvatar({required this.name, this.photoUrl});

  final String name;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) {
    final letter = name.isNotEmpty ? name[0].toUpperCase() : '?';
    if (photoUrl != null && photoUrl!.isNotEmpty) {
      return ClipOval(
        child: SizedBox(
          width: 30,
          height: 30,
          child: CachedImage(
            url: photoUrl!,
            fit: BoxFit.cover,
            width: 30,
            height: 30,
            error: Container(
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppTheme.gradient,
              ),
              alignment: Alignment.center,
              child: Text(
                letter,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ),
        ),
      );
    }
    return Container(
      width: 30,
      height: 30,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: AppTheme.gradient,
      ),
      child: Center(
        child: Text(
          letter,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

// ── Course card ────────────────────────────────────────────────

class CourseCard extends StatelessWidget {
  const CourseCard({
    super.key,
    required this.course,
    required this.locale,
    required this.onTap,
    required this.onReact,
    this.onFavorite,
  });

  final Map<String, dynamic> course;
  final String locale;
  final VoidCallback onTap;
  final ValueChanged<String> onReact;
  final VoidCallback? onFavorite;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final title = localizedText(course, locale);
    final teacher = course['teacher'] as Map<String, dynamic>?;
    final teacherName =
        (teacher?['user'] as Map<String, dynamic>?)?['fullLegalName']?.toString() ??
            l10n.t('student.teacher');
    final rating = (course['teacherRating'] as num?)?.toDouble() ?? 0;
    final ratingCount = (course['teacherRatingCount'] as num?)?.toInt() ?? 0;
    final courseRating = (course['courseRating'] as num?)?.toDouble();
    final courseRatingCount = (course['courseRatingCount'] as num?)?.toInt() ?? 0;
    final teacherLevel = teacher?['level']?.toString();
    String levelStars = switch (teacherLevel) {
      'MASTER' => ' ★★★',
      'EXCELLENT' => ' ★★',
      'GOOD' => ' ★',
      _ => '',
    };
    final views = (course['viewCount'] as num?)?.toInt() ?? 0;
    final likes = (course['likes'] as num?)?.toInt() ?? 0;
    final dislikes = (course['dislikes'] as num?)?.toInt() ?? 0;
    final myReaction = course['myReaction']?.toString();
    final price = (course['price'] as num?)?.toDouble() ?? 0;
    final currency = course['currency']?.toString() ?? 'IQD';
    final isFree = price <= 0;
    final purchaseStatus = course['purchaseStatus']?.toString();
    final isOwnCourse = course['isOwnCourse'] == true;
    final totalSec = (course['totalDurationSec'] as num?)?.toInt() ??
        (((course['lessons'] as List<dynamic>?) ?? []).fold<int>(
          0,
          (s, l) => s + (((l as Map)['durationSec'] as num?)?.toInt() ?? 0),
        ));
    final lessonsCount = (course['lessonsCount'] as num?)?.toInt() ??
        ((course['lessons'] as List?)?.length ?? 0);
    final subscribers = (course['subscribersCount'] as num?)?.toInt() ??
        ((course['_count'] as Map?)?['purchases'] as num?)?.toInt() ??
        0;
    final previews = (course['freePreviewCount'] as num?)?.toInt() ?? 0;
    final thumbnail = course['thumbnail']?.toString();
    final id = course['id'].toString();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Cover with duration + price overlays.
            Hero(
              tag: 'course-cover-$id',
              child: AspectRatio(
                aspectRatio: 16 / 8,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (thumbnail != null && thumbnail.isNotEmpty)
                      CachedImage(
                        url: thumbnail,
                        fit: BoxFit.cover,
                        cacheVersion: course['updatedAt']?.toString(),
                        placeholder: const _CoverFallback(),
                        error: const _CoverFallback(),
                      )
                    else
                      const _CoverFallback(),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Colors.transparent,
                            Colors.black.withValues(alpha: 0.45),
                          ],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ),
                      ),
                    ),
                    Positioned(
                      left: 10,
                      bottom: 10,
                      child: _CoverChip(
                        icon: Icons.schedule,
                        label: formatDuration(totalSec),
                      ),
                    ),
                    Positioned(
                      right: 10,
                      bottom: 10,
                      child: _CoverChip(
                        icon: Icons.play_circle_outline,
                        label: l10n.homeLessons(lessonsCount),
                      ),
                    ),
                    if (subscribers > 0)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 10,
                        child: Center(
                          child: _CoverChip(
                            icon: Icons.people_outline,
                            label: l10n.homeSubscribers(subscribers),
                          ),
                        ),
                      ),
                    Positioned(
                      right: 10,
                      top: 10,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          gradient: isFree ? null : AppTheme.gradient,
                          color: isFree ? Colors.green.shade600 : null,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          isFree
                              ? l10n.t('mobile.home.free').toUpperCase()
                              : '${price.toStringAsFixed(0)} $currency',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      left: 10,
                      top: 10,
                      child: Row(
                        children: [
                          if (onFavorite != null)
                            FavoriteButton(
                              active: course['favoritedByMe'] == true,
                              onTap: onFavorite!,
                            ),
                          if (purchaseStatus == 'PAID') ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.green.shade600,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.check_circle,
                                      size: 13, color: Colors.white),
                                  SizedBox(width: 4),
                                  Text(
                                    l10n.studentPurchased,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
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
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  // Teacher + rating row.
                  Row(
                    children: [
                      _TeacherAvatar(
                        name: teacherName,
                        photoUrl: (teacher?['user'] as Map<String, dynamic>?)?['profilePhotoUrl']
                            ?.toString(),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '$teacherName$levelStars',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: AppTheme.muted),
                        ),
                      ),
                      const Icon(Icons.star_rounded, size: 17, color: Colors.amber),
                      const SizedBox(width: 3),
                      Text(
                        rating > 0 ? rating.toStringAsFixed(1) : '—',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                      if (ratingCount > 0)
                        Text(
                          ' (${formatCount(ratingCount)})',
                          style: TextStyle(fontSize: 12, color: AppTheme.muted),
                        ),
                    ],
                  ),
                  if (courseRating != null && courseRating > 0) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(Icons.menu_book_rounded, size: 14, color: AppTheme.accent.withValues(alpha: 0.9)),
                        const SizedBox(width: 6),
                        Text(
                          l10n.t('mobile.store.courseRating', {
                            'rating': courseRating.toStringAsFixed(1),
                          }),
                          style: TextStyle(fontSize: 12, color: AppTheme.muted),
                        ),
                        if (courseRatingCount > 0)
                          Text(
                            ' (${formatCount(courseRatingCount)})',
                            style: TextStyle(fontSize: 12, color: AppTheme.muted),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 12),
                  // Stats row: views + like/dislike + previews.
                  Row(
                    children: [
                      Icon(Icons.visibility_outlined, size: 17, color: AppTheme.muted),
                      const SizedBox(width: 4),
                      Text(
                        formatCount(views),
                        style: TextStyle(fontSize: 12.5, color: AppTheme.muted),
                      ),
                      const SizedBox(width: 14),
                      Icon(Icons.people_outline, size: 17, color: AppTheme.muted),
                      const SizedBox(width: 4),
                      Text(
                        formatCount(subscribers),
                        style: TextStyle(fontSize: 12.5, color: AppTheme.muted),
                      ),
                      const SizedBox(width: 14),
                      ReactionButton(
                        icon: Icons.thumb_up_outlined,
                        activeIcon: Icons.thumb_up,
                        active: myReaction == 'LIKE',
                        activeColor: AppTheme.accent,
                        count: likes,
                        onTap: () => onReact('LIKE'),
                      ),
                      const SizedBox(width: 12),
                      ReactionButton(
                        icon: Icons.thumb_down_outlined,
                        activeIcon: Icons.thumb_down,
                        active: myReaction == 'DISLIKE',
                        activeColor: Colors.redAccent,
                        count: dislikes,
                        onTap: () => onReact('DISLIKE'),
                      ),
                      const Spacer(),
                      if (!isFree && purchaseStatus != 'PAID' && previews > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppTheme.primary.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            l10n.t('common.free'),
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppTheme.accent,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  // Subscribe button for unpurchased paid courses (not for course owners).
                  if (!isFree && purchaseStatus != 'PAID' && !isOwnCourse) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      height: 42,
                      child: purchaseStatus == 'PENDING'
                          ? OutlinedButton.icon(
                              onPressed: onTap,
                              icon: const Icon(Icons.hourglass_top, size: 17),
                              label: Text(l10n.homeAwaitingPayment),
                            )
                          : FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: AppTheme.primary,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                              onPressed: onTap,
                              icon: const Icon(Icons.workspace_premium_outlined, size: 18),
                              label: Text(l10n.subscribe),
                            ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoverChip extends StatelessWidget {
  const _CoverChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 11.5),
          ),
        ],
      ),
    );
  }
}

/// Frosted round bookmark toggle used on covers and app bars.
class FavoriteButton extends StatelessWidget {
  const FavoriteButton({super.key, required this.active, required this.onTap, this.size = 32});

  final bool active;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.black.withValues(alpha: 0.5),
          border: Border.all(
            color: active ? Colors.redAccent : Colors.white24,
          ),
        ),
        child: Center(
          child: AnimatedScale(
            scale: active ? 1.15 : 1,
            duration: const Duration(milliseconds: 300),
            curve: Curves.elasticOut,
            child: Icon(
              active ? Icons.favorite : Icons.favorite_border,
              size: size * 0.55,
              color: active ? Colors.redAccent : Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

/// Animated like/dislike button with a springy icon and count.
class ReactionButton extends StatelessWidget {
  const ReactionButton({
    super.key,
    required this.icon,
    required this.activeIcon,
    required this.active,
    required this.activeColor,
    required this.count,
    required this.onTap,
  });

  final IconData icon;
  final IconData activeIcon;
  final bool active;
  final Color activeColor;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedScale(
            scale: active ? 1.2 : 1,
            duration: const Duration(milliseconds: 300),
            curve: Curves.elasticOut,
            child: Icon(
              active ? activeIcon : icon,
              size: 17,
              color: active ? activeColor : AppTheme.muted,
            ),
          ),
          const SizedBox(width: 4),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            transitionBuilder: (child, anim) => FadeTransition(
              opacity: anim,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0, 0.4),
                  end: Offset.zero,
                ).animate(anim),
                child: child,
              ),
            ),
            child: Text(
              formatCount(count),
              key: ValueKey(count),
              style: TextStyle(
                fontSize: 12.5,
                color: active ? activeColor : AppTheme.muted,
                fontWeight: active ? FontWeight.w700 : FontWeight.normal,
              ),
            ),
          ),
        ],
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
            AppTheme.primary.withValues(alpha: 0.35),
            AppTheme.accent.withValues(alpha: 0.2),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: const Center(
        child: Icon(Icons.play_circle_outline, size: 44, color: Colors.white70),
      ),
    );
  }
}

// ── Loading skeleton ───────────────────────────────────────────

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        children: const [
          // Welcome header
          SkeletonBox(height: 110, radius: 20),
          SizedBox(height: 16),
          // Search + filter chips
          SkeletonBox(height: 48, radius: 14),
          SizedBox(height: 10),
          Row(
            children: [
              SkeletonBox(width: 88, height: 32, radius: 999),
              SizedBox(width: 8),
              SkeletonBox(width: 88, height: 32, radius: 999),
              SizedBox(width: 8),
              SkeletonBox(width: 88, height: 32, radius: 999),
            ],
          ),
          SizedBox(height: 20),
          // Ads carousel
          SkeletonBox(height: 150, radius: 18),
          SizedBox(height: 16),
          // Course cards
          SkeletonCourseCard(),
          SkeletonCourseCard(),
        ],
      ),
    );
  }
}
