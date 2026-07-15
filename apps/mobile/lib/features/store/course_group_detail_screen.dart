import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

String _localizedTitle(Map<String, dynamic> item, String locale) {
  final key = switch (locale) {
    'AR' => 'titleAr',
    'KU' => 'titleKu',
    'TR' => 'titleTr',
    _ => 'titleEn',
  };
  final localized = item[key]?.toString();
  if (localized != null && localized.isNotEmpty) return localized;
  return item['titleEn']?.toString() ?? '';
}

/// Detail + offline Subscribe for a stage course group (bundle).
class CourseGroupDetailScreen extends StatefulWidget {
  const CourseGroupDetailScreen({
    super.key,
    required this.groupId,
    this.summary,
  });

  final String groupId;
  final Map<String, dynamic>? summary;

  @override
  State<CourseGroupDetailScreen> createState() =>
      _CourseGroupDetailScreenState();
}

class _CourseGroupDetailScreenState extends State<CourseGroupDetailScreen> {
  Map<String, dynamic>? _group;
  bool _loading = true;
  bool _buying = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _group = widget.summary != null
        ? Map<String, dynamic>.from(widget.summary!)
        : null;
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context
          .read<ApiClient>()
          .get('/api/store/course-groups/${widget.groupId}');
      if (!mounted) return;
      final group = data['group'];
      setState(() {
        _group = group is Map
            ? Map<String, dynamic>.from(group)
            : _group;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.t('mobile.error.generic');
      });
    }
  }

  Future<void> _subscribe() async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final api = context.read<ApiClient>();
    setState(() => _buying = true);
    try {
      await api.post('/api/store/course-groups/${widget.groupId}/purchase', {});
      if (!mounted) return;
      setState(() => _group?['purchaseStatus'] = 'PENDING');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.storeSubscriptionRequested)),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      final code = e.message;
      final msg = switch (code) {
        'ALREADY_PENDING' || 'ALREADY_REQUESTED' =>
          context.l10n.t('student.purchaseAlreadyRequested'),
        'ALREADY_PURCHASED' => context.l10n.t('mobile.home.groupAlreadyOwned'),
        _ => context.l10n.t('mobile.error.generic'),
      };
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      if (code == 'ALREADY_PENDING') {
        setState(() => _group?['purchaseStatus'] = 'PENDING');
      }
    } finally {
      if (mounted) setState(() => _buying = false);
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
    final locale = context.localeCode;
    final l10n = context.l10n;
    final group = _group;
    final title = group == null ? '' : _localizedTitle(group, locale);
    final cover = group?['coverUrl']?.toString();
    final price = (group?['totalPrice'] as num?)?.toDouble() ?? 0;
    final currency = group?['currency']?.toString() ?? 'IQD';
    final purchaseStatus = group?['purchaseStatus']?.toString();
    final purchased = group?['purchased'] == true || purchaseStatus == 'PAID';
    final courses = ((group?['courses'] as List<dynamic>?) ?? [])
        .cast<Map<String, dynamic>>();
    final courseCount =
        (group?['courseCount'] as num?)?.toInt() ?? courses.length;
    final description = group?['description']?.toString();

    return Scaffold(
      body: _loading && group == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && group == null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () {
                          setState(() => _loading = true);
                          _load();
                        },
                        child: Text(l10n.retry),
                      ),
                    ],
                  ),
                )
              : CustomScrollView(
                  slivers: [
                    SliverAppBar(
                      expandedHeight: 220,
                      pinned: true,
                      flexibleSpace: FlexibleSpaceBar(
                        title: Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16),
                        ),
                        background: cover != null && cover.isNotEmpty
                            ? CachedImage(
                                url: cover,
                                fit: BoxFit.cover,
                                width: double.infinity,
                                height: double.infinity,
                              )
                            : Container(
                                color: AppTheme.primary.withValues(alpha: 0.25),
                                child: Center(
                                  child: Icon(
                                    Icons.collections_bookmark_outlined,
                                    size: 64,
                                    color: AppTheme.muted,
                                  ),
                                ),
                              ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              l10n.t(
                                'mobile.home.groupCourseCount',
                                {'count': '$courseCount'},
                              ),
                              style: TextStyle(color: AppTheme.muted),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${price.toStringAsFixed(0)} $currency',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.accent,
                              ),
                            ),
                            if (description != null &&
                                description.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(
                                description,
                                style: TextStyle(
                                  color: AppTheme.muted,
                                  height: 1.4,
                                ),
                              ),
                            ],
                            if (purchased) ...[
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.primary.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  l10n.t('mobile.home.groupUnlocked'),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.primary,
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 20),
                            Text(
                              l10n.t('mobile.home.groupIncludes'),
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (courses.isEmpty)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            l10n.homeNoCoursesInStage,
                            style: TextStyle(color: AppTheme.muted),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    else
                      SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, i) {
                            final c = courses[i];
                            final cTitle = _localizedTitle(c, locale);
                            final thumb = c['thumbnail']?.toString();
                            final cPrice =
                                (c['price'] as num?)?.toDouble() ?? 0;
                            final cCurrency =
                                c['currency']?.toString() ?? currency;
                            return ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 20,
                                vertical: 4,
                              ),
                              leading: ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: SizedBox(
                                  width: 64,
                                  height: 48,
                                  child: thumb != null && thumb.isNotEmpty
                                      ? CachedImage(
                                          url: thumb,
                                          fit: BoxFit.cover,
                                        )
                                      : Container(
                                          color: AppTheme.cardBorder,
                                          child: Icon(
                                            Icons.play_circle_outline,
                                            color: AppTheme.muted,
                                          ),
                                        ),
                                ),
                              ),
                              title: Text(
                                cTitle,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                '${cPrice.toStringAsFixed(0)} $cCurrency',
                                style: TextStyle(
                                  color: AppTheme.muted,
                                  fontSize: 13,
                                ),
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => _openCourse(c),
                            );
                          },
                          childCount: courses.length,
                        ),
                      ),
                    const SliverToBoxAdapter(child: SizedBox(height: 100)),
                  ],
                ),
      bottomNavigationBar: purchased || group == null
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                decoration: BoxDecoration(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  border: Border(
                    top: BorderSide(color: AppTheme.cardBorder),
                  ),
                ),
                child: Row(
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          l10n.t('mobile.home.groupTotal'),
                          style: TextStyle(
                            fontSize: 12,
                            color: AppTheme.muted,
                          ),
                        ),
                        Text(
                          '${price.toStringAsFixed(0)} $currency',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.accent,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: SizedBox(
                        height: 48,
                        child: purchaseStatus == 'PENDING'
                            ? OutlinedButton.icon(
                                onPressed: null,
                                icon: const Icon(Icons.hourglass_top, size: 18),
                                label: Text(l10n.studentPurchasePending),
                              )
                            : FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppTheme.primary,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                ),
                                onPressed: _buying ? null : _subscribe,
                                icon: const Icon(
                                  Icons.workspace_premium_outlined,
                                ),
                                label: Text(
                                  _buying
                                      ? l10n.t('student.issuing')
                                      : l10n.subscribe,
                                ),
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
